import { User, Session, AuthEvent } from "@prisma/client";

export interface IUserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(data: { email: string; passwordHash: string | null }): Promise<User>;
  incrementFailedLoginAttempts(id: string): Promise<User>;
  resetFailedLoginAttempts(id: string): Promise<User>;
  lockAccountUntil(id: string, until: Date): Promise<User>;
  findAllPaginated(
    page: number,
    limit: number,
  ): Promise<{ users: User[]; total: number }>;
  updateRole(id: string, role: string): Promise<User>;
}

export interface ISessionRepository {
  create(data: {
    userId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<Session>;
  findById(id: string): Promise<Session | null>;
  findByRefreshToken(refreshToken: string): Promise<Session | null>;
  revoke(id: string): Promise<Session>;
  revokeAllForUser(userId: string): Promise<void>;
  findActiveByUserId(userId: string): Promise<Session[]>;
  findAllByUserId(userId: string): Promise<Session[]>;
  findAllPaginated(
    page: number,
    limit: number,
  ): Promise<{ sessions: Session[]; total: number }>;
}

export interface IAuditEventRepository {
  findPaginated(
    page: number,
    limit: number,
    userId?: string,
  ): Promise<{ events: AuthEvent[]; total: number }>;
}
