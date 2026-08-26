import { Request, Response } from "express";
import { sessionRepository } from "../../db/repo/session.repository";
import { signAccessToken, generateRefreshToken } from "./token.service";
import { UnauthorizedError } from "../../core/errors/AppError";
import { asyncHandler } from "../../middleware/asyncHandler";
import { logEvent } from "../../core/audit/auditLogger";
import env from "../../config/env";
import prisma from "../../db/prisma";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const oldToken = req.cookies?.refreshToken;

  if (!oldToken) {
    res.clearCookie("refreshToken");
    throw new UnauthorizedError("No refresh token provided");
  }

  const session = await sessionRepository.findByRefreshToken(oldToken);

  if (!session) {
    res.clearCookie("refreshToken");
    throw new UnauthorizedError("Invalid refresh token");
  }

  if (session.revoked) {
    await sessionRepository.revokeAllForUser(session.userId);
    await logEvent("breach_suspected", session.userId, req.ip ?? null, {
      reusedSessionId: session.id,
    });
    res.clearCookie("refreshToken");
    throw new UnauthorizedError("Session invalid, all sessions revoked");
  }

  await sessionRepository.revoke(session.id);

  const newRefreshToken = generateRefreshToken();
  await sessionRepository.create({
    userId: session.userId,
    refreshToken: newRefreshToken,
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: req.ip ?? null,
    expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
  });

  const accessToken = signAccessToken(session.userId);

  res.cookie("refreshToken", newRefreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SEVEN_DAYS_MS,
  });

  res.status(200).json({ accessToken });
});
