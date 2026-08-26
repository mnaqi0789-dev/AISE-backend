import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./requireAuth";
import { userRepository } from "../db/repo/user.repository";
import { ForbiddenError, UnauthorizedError } from "../core/errors/AppError";

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new UnauthorizedError("Not authenticated");
    }

    userRepository
      .findById(req.user.userId)
      .then((user) => {
        if (!user || !allowedRoles.includes(user.role)) {
          throw new ForbiddenError("Insufficient permissions");
        }
        next();
      })
      .catch(next);
  };
}
