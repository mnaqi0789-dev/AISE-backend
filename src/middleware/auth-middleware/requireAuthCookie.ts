import { Response, NextFunction } from "express";
import { sessionRepository } from "../db/repo/session.repository";
import { UnauthorizedError } from "../core/errors/AppError";
import { AuthenticatedRequest } from "./requireAuth";

export async function requireAuthCookie(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    throw new UnauthorizedError("Not authenticated");
  }

  const session = await sessionRepository.findByRefreshToken(refreshToken);

  if (!session || session.revoked || session.expiresAt < new Date()) {
    throw new UnauthorizedError("Session invalid or expired");
  }

  req.user = { userId: session.userId };
  next();
}
