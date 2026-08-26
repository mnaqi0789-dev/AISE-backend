import prisma from "../prisma";
import { IUserRepository } from "./interfaces";

export const userRepository: IUserRepository = {
  findByEmail(email) {
    return prisma.user.findUnique({ where: { email } });
  },

  findById(id) {
    return prisma.user.findUnique({ where: { id } });
  },

  create(data) {
    return prisma.user.create({ data });
  },

  incrementFailedLoginAttempts(id) {
    return prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: { increment: 1 } },
    });
  },

  resetFailedLoginAttempts(id) {
    return prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  },

  lockAccountUntil(id, until) {
    return prisma.user.update({
      where: { id },
      data: { lockedUntil: until },
    });
  },

  async findAllPaginated(page, limit) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count(),
    ]);
    return { users, total };
  },

  updateRole(id, role) {
    return prisma.user.update({
      where: { id },
      data: { role },
    });
  },
};
