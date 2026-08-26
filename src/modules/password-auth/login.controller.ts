import { Request, Response } from "express";
import { z } from "zod";
import { userRepository } from "../../db/repo/user.repository";
import { comparePassword } from "./password.service";
import { issueSession } from "../tokens/session.service";
import { UnauthorizedError, ValidationError } from "../../core/errors/AppError";
import { asyncHandler } from "../../middleware/asyncHandler";
import { logEvent } from "../../core/audit/auditLogger";
import env from "../../config/env";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

function minutesFromNow(date: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60000));
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid input",
    );
  }

  const { email, password } = parsed.data;

  const user = await userRepository.findByEmail(email);
  if (!user || !user.passwordHash) {
    throw new UnauthorizedError("Invalid email or password");
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = minutesFromNow(user.lockedUntil);
    throw new UnauthorizedError(
      `Account locked. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    );
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    const updated = await userRepository.incrementFailedLoginAttempts(user.id);
    await logEvent("login_failed", user.id, req.ip ?? null);

    if (updated.failedLoginAttempts >= MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
      await userRepository.lockAccountUntil(user.id, lockedUntil);
      await logEvent("account_locked", user.id, req.ip ?? null);
      const mins = minutesFromNow(lockedUntil);
      throw new UnauthorizedError(
        `Account locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      );
    }

    const remaining = MAX_ATTEMPTS - updated.failedLoginAttempts;
    throw new UnauthorizedError(
      `Invalid email or password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before lockout.`,
    );
  }

  await userRepository.resetFailedLoginAttempts(user.id);
  await logEvent("login_success", user.id, req.ip ?? null);

  const { accessToken, refreshToken } = await issueSession(user.id, req);

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.status(200).json({
    accessToken,
    user: { id: user.id, email: user.email, role: user.role },
  });
});
