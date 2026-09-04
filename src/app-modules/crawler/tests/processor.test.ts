import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job, Queue } from "bullmq";
import type Redis from "ioredis";

vi.mock("./robot", () => ({ canCrawl: vi.fn() }));
vi.mock("./fetcher", () => ({ fetchUrl: vi.fn() }));
vi.mock("./links", () => ({ extractLinks: vi.fn() }));
vi.mock("./dedup", () => ({ filterNewUrls: vi.fn() }));
vi.mock("./seed", () => ({ isInScope: vi.fn() }));
vi.mock("../../db/prisma", () => ({
  default: {
    rawFetch: { create: vi.fn() },
    lens: { findUnique: vi.fn() },
  },
}));

import { canCrawl } from "../robot";
import { fetchUrl } from "../fetcher";
import { extractLinks } from "../links";
import { filterNewUrls } from "../dedup";
import { isInScope } from "../seed";
import prisma from "../../../db/prisma";
import { processCrawlJob, JOB_OPTS } from "../processor";

function makeJob(data: any): Job<any> {
  return { data, name: "crawlJob" } as Job<any>;
}

describe("processCrawlJob", () => {
  let connection: Partial<Redis>;
  let crawlQueue: Partial<Queue<any>>;

  beforeEach(() => {
    vi.clearAllMocks();
    connection = {
      set: vi.fn().mockResolvedValue("OK"),
      pttl: vi.fn().mockResolvedValue(5000),
    };
    crawlQueue = { add: vi.fn().mockResolvedValue(undefined) };
  });

  it("returns early when robots.txt disallows the URL", async () => {
    (canCrawl as any).mockResolvedValue({ isAllowed: false, crawlDelay: null });
    const job = makeJob({
      url: "https://example.com/a",
      domain: "example.com",
      depth: 0,
      lensId: "l1",
      maxDepth: 2,
    });

    await processCrawlJob(job, connection as Redis, crawlQueue as Queue<any>);

    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it("re-queues with a delay when the domain lock is already held", async () => {
    (canCrawl as any).mockResolvedValue({ isAllowed: true, crawlDelay: 10 });
    (connection.set as any).mockResolvedValue(null);
    const job = makeJob({
      url: "https://example.com/a",
      domain: "example.com",
      depth: 0,
      lensId: "l1",
      maxDepth: 2,
    });

    await processCrawlJob(job, connection as Redis, crawlQueue as Queue<any>);

    expect(crawlQueue.add).toHaveBeenCalledWith(
      "crawlJob",
      job.data,
      expect.objectContaining({ delay: 5000 }),
    );
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it("records a 4xx response without throwing or extracting links", async () => {
    (canCrawl as any).mockResolvedValue({ isAllowed: true, crawlDelay: null });
    (fetchUrl as any).mockResolvedValue({
      url: "https://example.com/missing",
      domain: "example.com",
      statusCode: 404,
      headers: {},
      rawHtml: "",
      fetchedAt: new Date(),
      extracted: false,
    });
    const job = makeJob({
      url: "https://example.com/missing",
      domain: "example.com",
      depth: 0,
      lensId: "l1",
      maxDepth: 2,
    });

    await processCrawlJob(job, connection as Redis, crawlQueue as Queue<any>);

    expect(prisma.rawFetch.create).toHaveBeenCalledOnce();
    expect(extractLinks).not.toHaveBeenCalled();
  });

  it("throws on a 5xx response to trigger BullMQ retry", async () => {
    (canCrawl as any).mockResolvedValue({ isAllowed: true, crawlDelay: null });
    (fetchUrl as any).mockResolvedValue({
      url: "https://example.com/err",
      domain: "example.com",
      statusCode: 503,
      headers: {},
      rawHtml: "",
      fetchedAt: new Date(),
      extracted: false,
    });
    const job = makeJob({
      url: "https://example.com/err",
      domain: "example.com",
      depth: 0,
      lensId: "l1",
      maxDepth: 2,
    });

    await expect(
      processCrawlJob(job, connection as Redis, crawlQueue as Queue<any>),
    ).rejects.toThrow("503");
    expect(prisma.rawFetch.create).not.toHaveBeenCalled();
  });

  it("stops after persisting once depth reaches maxDepth", async () => {
    (canCrawl as any).mockResolvedValue({ isAllowed: true, crawlDelay: null });
    (fetchUrl as any).mockResolvedValue({
      url: "https://example.com/a",
      domain: "example.com",
      statusCode: 200,
      headers: {},
      rawHtml: "<html></html>",
      fetchedAt: new Date(),
      extracted: false,
    });
    const job = makeJob({
      url: "https://example.com/a",
      domain: "example.com",
      depth: 2,
      lensId: "l1",
      maxDepth: 2,
    });

    await processCrawlJob(job, connection as Redis, crawlQueue as Queue<any>);

    expect(prisma.rawFetch.create).toHaveBeenCalledOnce();
    expect(prisma.lens.findUnique).not.toHaveBeenCalled();
  });

  it("filters links to in-scope domains, dedups, and re-queues at depth+1", async () => {
    (canCrawl as any).mockResolvedValue({ isAllowed: true, crawlDelay: null });
    (fetchUrl as any).mockResolvedValue({
      url: "https://example.com/a",
      domain: "example.com",
      statusCode: 200,
      headers: {},
      rawHtml: "<html></html>",
      fetchedAt: new Date(),
      extracted: false,
    });
    (prisma.lens.findUnique as any).mockResolvedValue({
      id: "l1",
      domains: ["example.com"],
    });
    (extractLinks as any).mockReturnValue([
      "https://example.com/b",
      "https://other.com/c",
    ]);
    (isInScope as any).mockImplementation((url: string) =>
      url.includes("example.com"),
    );
    (filterNewUrls as any).mockImplementation(async (urls: string[]) => urls);
    const job = makeJob({
      url: "https://example.com/a",
      domain: "example.com",
      depth: 0,
      lensId: "l1",
      maxDepth: 2,
    });

    await processCrawlJob(job, connection as Redis, crawlQueue as Queue<any>);

    expect(filterNewUrls).toHaveBeenCalledWith(["https://example.com/b"]);
    expect(crawlQueue.add).toHaveBeenCalledWith(
      "crawlJob",
      expect.objectContaining({ url: "https://example.com/b", depth: 1 }),
      JOB_OPTS,
    );
  });
});
