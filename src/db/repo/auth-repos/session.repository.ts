import prisma from "../prisma";
import { ISessionRepository } from "./interfaces";

export const sessionRepository: ISessionRepository = {
  create(data) {
    return prisma.session.create({ data });
  },

  findById(id) {
    return prisma.session.findUnique({ where: { id } });
  },

  findByRefreshToken(refreshToken) {
    return prisma.session.findUnique({ where: { refreshToken } });
  },

  revoke(id) {
    return prisma.session.update({
      where: { id },
      data: { revoked: true },
    });
  },

  async revokeAllForUser(userId) {
    await prisma.session.updateMany({
      where: { userId },
      data: { revoked: true },
    });
  },

  findActiveByUserId(userId) {
    return prisma.session.findMany({
      where: { userId, revoked: false },
    });
  },

  findAllByUserId(userId) {
    return prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  },

  async findAllPaginated(page, limit) {
    const skip = (page - 1) * limit;
    const [sessions, total] = await Promise.all([
      prisma.session.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.session.count(),
    ]);
    return { sessions, total };
  },
};
