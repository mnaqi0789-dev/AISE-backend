import prisma from "../prisma";
import { IAuditEventRepository } from "./interfaces";

export const auditEventRepository: IAuditEventRepository = {
  async findPaginated(page, limit, userId) {
    const skip = (page - 1) * limit;
    const where = userId ? { userId } : {};
    const [events, total] = await Promise.all([
      prisma.authEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.authEvent.count({ where }),
    ]);
    return { events, total };
  },
};
