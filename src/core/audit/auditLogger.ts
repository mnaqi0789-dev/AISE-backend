import prisma from "../../db/prisma";
import { Prisma } from "@prisma/client";

export async function logEvent(
  type: string,
  userId: string | null,
  ipAddress: string | null,
  metadata?: Record<string, unknown>,
) {
  try {
    await prisma.authEvent.create({
      data: {
        type,
        userId,
        ipAddress,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    console.error("Failed to write audit event", err);
  }
}
