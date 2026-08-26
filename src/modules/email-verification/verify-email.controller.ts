import { Request, Response } from "express";
import { hashToken } from "../tokens/hash.util";
import prisma from "../../db/prisma";
import { UnauthorizedError } from "../../core/errors/AppError";
import { asyncHandler } from "../../middleware/asyncHandler";
import { logEvent } from "../../core/audit/auditLogger";

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;

  if (typeof token !== "string") {
    throw new UnauthorizedError("Invalid verification token");
  }

  const tokenHash = hashToken(token);
  const tokenRow = await prisma.token.findUnique({ where: { tokenHash } });

  if (
    !tokenRow ||
    tokenRow.type !== "email_verification" ||
    tokenRow.used ||
    tokenRow.expiresAt < new Date()
  ) {
    throw new UnauthorizedError("Invalid or expired verification token");
  }

  await prisma.user.update({
    where: { id: tokenRow.userId },
    data: { emailVerified: true },
  });

  await prisma.token.update({
    where: { id: tokenRow.id },
    data: { used: true },
  });

  await logEvent("email_verified", tokenRow.userId, req.ip ?? null);

  res.status(200).json({ message: "Email verified successfully" });
});
