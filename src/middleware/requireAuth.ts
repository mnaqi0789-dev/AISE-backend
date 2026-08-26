import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../modules/tokens/token.service";
import { UnauthorizedError } from "../core/errors/AppError";

export interface AuthenticatedRequest extends Request {
  user?: { userId: string };
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or invalid authorization header");
  }

  const token = header.slice(7);

  try {
    const payload = verifyAccessToken(token);
    req.user = { userId: payload.userId };
    next();
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
}
