import { Request } from "express";
import { signAccessToken, generateRefreshToken } from "./token.service";
import { sessionRepository } from "../../db/repo/session.repository";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function issueSession(userId: string, req: Request) {
  const accessToken = signAccessToken(userId);
  const refreshToken = generateRefreshToken();

  await sessionRepository.create({
    userId,
    refreshToken,
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: req.ip ?? null,
    expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
  });

  return { accessToken, refreshToken };
}
