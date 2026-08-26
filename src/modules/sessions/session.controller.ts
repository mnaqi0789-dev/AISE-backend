import { Response } from "express";
import { sessionRepository } from "../../db/repo/session.repository";
import { asyncHandler } from "../../middleware/asyncHandler";
import { AuthenticatedRequest } from "../../middleware/requireAuth";
import { logEvent } from "../../core/audit/auditLogger";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../core/errors/AppError";

export const listSessions = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const sessions = await sessionRepository.findActiveByUserId(
      req.user!.userId,
    );

    const safe = sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));

    res.status(200).json(safe);
  },
);

export const revokeSession = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    if (typeof id !== "string") {
      throw new ValidationError("Invalid session id");
    }
    const session = await sessionRepository.findById(id);
    if (!session) {
      throw new NotFoundError("Session not found");
    }

    if (session.userId !== req.user!.userId) {
      throw new ForbiddenError("You do not own this session");
    }

    await sessionRepository.revoke(id);
    await logEvent("session_revoked", req.user!.userId, req.ip ?? null, {
      sessionId: id,
    });
    res.status(200).json({ message: "Session revoked" });
  },
);

export const revokeAllSessions = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    await sessionRepository.revokeAllForUser(req.user!.userId);
    res.status(200).json({ message: "All sessions revoked" });
  },
);

export const logout = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedError("No active session");
    }

    const session = await sessionRepository.findByRefreshToken(refreshToken);
    if (session) {
      await sessionRepository.revoke(session.id);
    }

    res.clearCookie("refreshToken");
    res.status(200).json({ message: "Logged out" });
  },
);
