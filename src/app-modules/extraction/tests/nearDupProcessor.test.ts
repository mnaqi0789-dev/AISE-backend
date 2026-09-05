import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import { processNearDupJob } from "../nearDupProcessor";

function makeJob(data: any): Job<any> {
  return { data } as Job<any>;
}

function makeFakePrisma() {
  return {
    document: { findMany: vi.fn(), update: vi.fn() },
  } as any;
}

describe("processNearDupJob", () => {
  let prisma: ReturnType<typeof makeFakePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makeFakePrisma();
  });

  it("sets nearDuplicateOfId when a candidate is within the Hamming threshold", async () => {
    prisma.document.findMany.mockResolvedValue([
      { id: "cand1", simhash: "0000000000000000", crawledAt: new Date() },
    ]);

    await processNearDupJob(
      makeJob({ documentId: "new1", simhash: "0000000000000007" }),
      prisma,
    );

    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: "new1" },
      data: { nearDuplicateOfId: "cand1" },
    });
  });

  it("does not update when no candidate is within the threshold", async () => {
    prisma.document.findMany.mockResolvedValue([
      { id: "cand1", simhash: "ffffffffffffffff", crawledAt: new Date() },
    ]);

    await processNearDupJob(
      makeJob({ documentId: "new1", simhash: "0000000000000000" }),
      prisma,
    );

    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it("excludes the document itself and already-marked duplicates from candidates", async () => {
    prisma.document.findMany.mockResolvedValue([]);

    await processNearDupJob(
      makeJob({ documentId: "new1", simhash: "0000000000000000" }),
      prisma,
    );

    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where: {
        id: { not: "new1" },
        simhash: { not: null },
        nearDuplicateOfId: null,
      },
      select: { id: true, simhash: true, crawledAt: true },
    });
  });

  it("stops at the first matching candidate rather than checking all", async () => {
    prisma.document.findMany.mockResolvedValue([
      { id: "cand1", simhash: "0000000000000000", crawledAt: new Date() },
      { id: "cand2", simhash: "0000000000000000", crawledAt: new Date() },
    ]);

    await processNearDupJob(
      makeJob({ documentId: "new1", simhash: "0000000000000000" }),
      prisma,
    );

    expect(prisma.document.update).toHaveBeenCalledTimes(1);
    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: "new1" },
      data: { nearDuplicateOfId: "cand1" },
    });
  });
});
