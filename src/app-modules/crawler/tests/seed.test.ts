import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./queue", () => ({ crawlQueue: { add: vi.fn() } }));
vi.mock("../../db/prisma", () => ({
  default: { lens: { findUnique: vi.fn() } },
}));

import { crawlQueue } from "../queue";
import prisma from "../../../db/prisma";
import { isInScope, startCrawlForLens } from "../seed";

describe("isInScope", () => {
  it("matches an exact domain", () => {
    expect(isInScope("https://example.com/page", ["example.com"])).toBe(true);
  });

  it("matches a subdomain of an allowed domain", () => {
    expect(isInScope("https://blog.example.com/page", ["example.com"])).toBe(
      true,
    );
  });

  it("rejects a domain that merely contains the allowed string", () => {
    expect(isInScope("https://notexample.com/page", ["example.com"])).toBe(
      false,
    );
  });

  it("rejects a domain not in the allowed list", () => {
    expect(isInScope("https://other.com/page", ["example.com"])).toBe(false);
  });
});

describe("startCrawlForLens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws if the lens does not exist", async () => {
    (prisma.lens.findUnique as any).mockResolvedValue(null);
    await expect(startCrawlForLens("missing-id", 2)).rejects.toThrow(
      "not found",
    );
  });

  it("queues one job per domain in the lens, at depth 0", async () => {
    (prisma.lens.findUnique as any).mockResolvedValue({
      id: "l1",
      domains: ["example.com", "https://other.com"],
    });
    await startCrawlForLens("l1", 3);
    expect(crawlQueue.add).toHaveBeenCalledTimes(2);
    expect(crawlQueue.add).toHaveBeenCalledWith(
      "crawlJob",
      expect.objectContaining({
        url: "https://example.com",
        domain: "example.com",
        depth: 0,
        lensId: "l1",
        maxDepth: 3,
      }),
      expect.anything(),
    );
  });
});
