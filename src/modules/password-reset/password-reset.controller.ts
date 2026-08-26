import { Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { userRepository } from "../../db/repo/user.repository";
import { sessionRepository } from "../../db/repo/session.repository";
import { hashPassword } from "../password-auth/password.service";
import { hashToken } from "../tokens/hash.util";
import prisma from "../../db/prisma";
import { ValidationError, UnauthorizedError } from "../../core/errors/AppError";
import { asyncHandler } from "../../middleware/asyncHandler";
import { logEvent } from "../../core/audit/auditLogger";
import { sendEmail } from "../../core/email/mailer";
import { passwordResetEmail } from "../../core/email/templates";
import { getPreferredDeliveryEmail } from "../oauth/linked-email.util";
import env from "../../config/env";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

export const forgotPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid input",
      );
    }

    const { email } = parsed.data;
    const user = await userRepository.findByEmail(email);

    if (user) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);

      await prisma.token.create({
        data: {
          userId: user.id,
          tokenHash,
          type: "password_reset",
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;
      const { subject, html } = passwordResetEmail(resetUrl);
      const deliveryEmail = await getPreferredDeliveryEmail(
        user.id,
        user.email,
      );

      sendEmail(deliveryEmail, subject, html).catch((err) =>
        console.error("Failed to send password reset email", err),
      );
    }

    res.status(200).json({
      message: "If that email exists, a reset link has been sent",
    });
  },
);

export const resetPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid input",
      );
    }

    const { token, newPassword } = parsed.data;
    const tokenHash = hashToken(token);

    const tokenRow = await prisma.token.findUnique({ where: { tokenHash } });

    if (
      !tokenRow ||
      tokenRow.type !== "password_reset" ||
      tokenRow.used ||
      tokenRow.expiresAt < new Date()
    ) {
      throw new UnauthorizedError("Invalid or expired reset token");
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: tokenRow.userId },
      data: { passwordHash },
    });

    await prisma.token.update({
      where: { id: tokenRow.id },
      data: { used: true },
    });

    await sessionRepository.revokeAllForUser(tokenRow.userId);
    await logEvent("password_reset", tokenRow.userId, req.ip ?? null);

    res.status(200).json({ message: "Password reset successful" });
  },
);
