import { Request, Response, NextFunction } from "express";
import prisma from "../db/prisma";

export function rateLimiter(maxRequests: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip ?? "unknown"}:${req.baseUrl}${req.path}`;
    const now = new Date();

    let entry = await prisma.rateLimitEntry.findUnique({ where: { key } });

    if (!entry || now > entry.resetAt) {
      entry = await prisma.rateLimitEntry.upsert({
        where: { key },
        create: { key, count: 0, resetAt: new Date(Date.now() + windowMs) },
        update: { count: 0, resetAt: new Date(Date.now() + windowMs) },
      });
    }

    const remaining = Math.max(0, maxRequests - entry.count - 1);
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(entry.resetAt.getTime()));

    if (entry.count >= maxRequests) {
      return res
        .status(429)
        .json({ error: "Too many requests, try again later" });
    }

    await prisma.rateLimitEntry.update({
      where: { key },
      data: { count: { increment: 1 } },
    });

    next();
  };
}
