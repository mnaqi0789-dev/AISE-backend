import { Response } from "express";
import { z } from "zod";
import { userRepository } from "../../db/repo/user.repository";
import { sessionRepository } from "../../db/repo/session.repository";
import { auditEventRepository } from "../../db/repo/audit.repository";
import { asyncHandler } from "../../middleware/asyncHandler";
import { AuthenticatedRequest } from "../../middleware/requireAuth";
import { NotFoundError, ValidationError } from "../../core/errors/AppError";
import env from "../../config/env";
import prisma from "../../db/prisma";

function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20),
  );
  return { page, limit };
}

export const listUsers = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit } = parsePagination(req.query);
    const { users, total } = await userRepository.findAllPaginated(page, limit);

    res.status(200).json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        emailVerified: u.emailVerified,
        lockedUntil: u.lockedUntil,
        createdAt: u.createdAt,
      })),
      page,
      limit,
      total,
    });
  },
);

export const getUserById = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    if (typeof id !== "string") {
      throw new ValidationError("Invalid user id");
    }

    const user = await userRepository.findById(id);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const sessions = await sessionRepository.findAllByUserId(id);
    const { events } = await auditEventRepository.findPaginated(1, 20, id);
    const oauthAccounts = await prisma.oAuthAccount.findMany({
      where: { userId: id },
    });

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        lockedUntil: user.lockedUntil,
        failedLoginAttempts: user.failedLoginAttempts,
        createdAt: user.createdAt,
      },
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        revoked: s.revoked,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
      recentEvents: events,
      oauthAccounts: oauthAccounts.map((a) => ({
        id: a.id,
        provider: a.provider,
        providerUserId: a.providerUserId,
        createdAt: a.createdAt,
      })),
    });
  },
);

export const listAuditEvents = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit } = parsePagination(req.query);
    const userId =
      typeof req.query.userId === "string" ? req.query.userId : undefined;
    const { events, total } = await auditEventRepository.findPaginated(
      page,
      limit,
      userId,
    );

    res.status(200).json({ events, page, limit, total });
  },
);

const updateRoleSchema = z.object({
  role: z.enum(["user", "admin"]),
});

export const updateUserRole = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    if (typeof id !== "string") {
      throw new ValidationError("Invalid user id");
    }

    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid role",
      );
    }

    const existing = await userRepository.findById(id);
    if (!existing) {
      throw new NotFoundError("User not found");
    }

    const updated = await userRepository.updateRole(id, parsed.data.role);

    res.status(200).json({
      id: updated.id,
      email: updated.email,
      role: updated.role,
    });
  },
);

export const unlockUser = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    if (typeof id !== "string") {
      throw new ValidationError("Invalid user id");
    }

    const existing = await userRepository.findById(id);
    if (!existing) {
      throw new NotFoundError("User not found");
    }

    const updated = await userRepository.resetFailedLoginAttempts(id);

    res.status(200).json({
      id: updated.id,
      email: updated.email,
      lockedUntil: updated.lockedUntil,
      failedLoginAttempts: updated.failedLoginAttempts,
    });
  },
);

export const listAllSessions = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit } = parsePagination(req.query);
    const { sessions, total } = await sessionRepository.findAllPaginated(
      page,
      limit,
    );

    res.status(200).json({
      sessions: sessions.map((s) => ({
        id: s.id,
        userId: s.userId,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        revoked: s.revoked,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
      page,
      limit,
      total,
    });
  },
);

export const getConfig = asyncHandler(
  async (_req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({
      rateLimitWindow: "15 minutes",
      rateLimitMax: 5,
      accessTokenTTL: "15m",
      refreshTokenTTL: "7d",
      sessionStrategy: "JWT access + DB-backed refresh with rotation",
      nodeEnv: env.NODE_ENV,
    });
  },
);

export const adminRevokeSession = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    if (typeof id !== "string") {
      throw new ValidationError("Invalid session id");
    }

    const session = await sessionRepository.findById(id);
    if (!session) {
      throw new NotFoundError("Session not found");
    }

    await sessionRepository.revoke(id);

    res.status(200).json({ message: "Session revoked" });
  },
);
