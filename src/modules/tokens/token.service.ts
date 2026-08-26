import jwt from "jsonwebtoken";
import crypto from "crypto";
import env from "../../config/env";

export function signAccessToken(userId: string): string {
  return jwt.sign({ userId }, env.JWT_ACCESS_SECRET, {
    expiresIn: "15m",
  });
}

export function verifyAccessToken(token: string): { userId: string } {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as { userId: string };
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString("hex");
}
