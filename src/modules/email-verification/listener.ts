import crypto from "crypto";
import { eventBus } from "../../core/events/eventBus";
import { hashToken } from "../tokens/hash.util";
import prisma from "../../db/prisma";
import { sendEmail } from "../../core/email/mailer";
import { verificationEmail } from "../../core/email/templates";
import env from "../../config/env";

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

eventBus.on("user.registered", async ({ userId }: { userId: string }) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);

    await prisma.token.create({
      data: {
        userId,
        tokenHash,
        type: "email_verification",
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      },
    });

    const verifyUrl = `${env.FRONTEND_URL}/verify-email/${rawToken}`;
    const { subject, html } = verificationEmail(verifyUrl);

    await sendEmail(user.email, subject, html);
  } catch (err) {
    console.error("Failed to create/send email verification token", err);
  }
});
