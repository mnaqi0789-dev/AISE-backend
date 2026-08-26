import { Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { userRepository } from "../../db/repo/user.repository";
import { hashToken } from "../tokens/hash.util";
import prisma from "../../db/prisma";
import { ValidationError } from "../../core/errors/AppError";
import { asyncHandler } from "../../middleware/asyncHandler";
import { sendEmail } from "../../core/email/mailer";
import { verificationEmail } from "../../core/email/templates";
import { getPreferredDeliveryEmail } from "../oauth/linked-email.util";
import env from "../../config/env";

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const resendSchema = z.object({
  email: z.string().email(),
});

export const resendVerification = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = resendSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid input",
      );
    }

    const { email } = parsed.data;
    const user = await userRepository.findByEmail(email);

    if (user && !user.emailVerified) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);

      await prisma.token.create({
        data: {
          userId: user.id,
          tokenHash,
          type: "email_verification",
          expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
        },
      });

      const verifyUrl = `${env.FRONTEND_URL}/verify-email/${rawToken}`;
      const { subject, html } = verificationEmail(verifyUrl);
      const deliveryEmail = await getPreferredDeliveryEmail(
        user.id,
        user.email,
      );

      sendEmail(deliveryEmail, subject, html).catch((err) =>
        console.error("Failed to send verification email", err),
      );
    }

    res.status(200).json({
      message:
        "If that email exists and is unverified, a new link has been sent",
    });
  },
);
