import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";

vi.mock("../contentExtractor", () => ({ extractContent: vi.fn() }));
vi.mock("../metadataExtractor", () => ({ extractMetadata: vi.fn() }));
vi.mock("../hashing", () => ({
  computeContentHash: vi.fn(),
  computeSimhash: vi.fn(),
}));
vi.mock("../nearDupQueue", () => ({ enqueueNearDupCheck: vi.fn() }));

import { extractContent } from "../contentExtractor";
import { extractMetadata } from "../metadataExtractor";
import { computeContentHash, computeSimhash } from "../hashing";
import { enqueueNearDupCheck } from "../nearDupQueue";
import { processExtractionJob } from "../extractionProcessor";

function makeJob(data: any): Job<any> {
  return { data } as Job<any>;
}

function makeFakePrisma() {
  return {
    rawFetch: { findUnique: vi.fn(), update: vi.fn() },
    document: { create: vi.fn() },
    $executeRaw: vi.fn(),
  } as any;
}

describe("processExtractionJob", () => {
  let prisma: ReturnType<typeof makeFakePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makeFakePrisma();
  });

  it("returns early when rawFetch does not exist", async () => {
    prisma.rawFetch.findUnique.mockResolvedValue(null);
    await processExtractionJob(makeJob({ rawFetchId: "x" }), prisma);
    expect(extractContent).not.toHaveBeenCalled();
  });

  it("returns early when rawHtml is missing", async () => {
    prisma.rawFetch.findUnique.mockResolvedValue({
      id: "x",
      rawHtml: null,
      url: "https://example.com",
    });
    await processExtractionJob(makeJob({ rawFetchId: "x" }), prisma);
    expect(extractContent).not.toHaveBeenCalled();
  });

  it("marks extracted=true and skips document creation on low content", async () => {
    prisma.rawFetch.findUnique.mockResolvedValue({
      id: "x",
      rawHtml: "<html></html>",
      url: "https://example.com",
    });
    (extractContent as any).mockReturnValue({
      cleanText: "hi",
      lowContent: true,
      method: "fallback",
    });

    await processExtractionJob(makeJob({ rawFetchId: "x" }), prisma);

    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(prisma.rawFetch.update).toHaveBeenCalledWith({
      where: { id: "x" },
      data: { extracted: true },
    });
  });

  it("creates a document, computes search_vector, and enqueues near-dup check on success", async () => {
    prisma.rawFetch.findUnique.mockResolvedValue({
      id: "x",
      rawHtml: "<html></html>",
      url: "https://example.com",
    });
    (extractContent as any).mockReturnValue({
      cleanText: "real content",
      lowContent: false,
      method: "readability",
    });
    (extractMetadata as any).mockReturnValue({
      title: "T",
      description: "D",
      canonicalUrl: "https://example.com",
      publishedAt: null,
      domain: "example.com",
    });
    (computeContentHash as any).mockReturnValue("hash123");
    (computeSimhash as any).mockReturnValue("simhash123");
    prisma.document.create.mockResolvedValue({ id: "doc1" });

    await processExtractionJob(makeJob({ rawFetchId: "x" }), prisma);

    expect(prisma.document.create).toHaveBeenCalledOnce();
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(enqueueNearDupCheck).toHaveBeenCalledWith("doc1", "simhash123");
    expect(prisma.rawFetch.update).toHaveBeenCalledWith({
      where: { id: "x" },
      data: { extracted: true },
    });
  });

  it("swallows a unique-constraint violation (P2002) without throwing, and skips search_vector computation", async () => {
    prisma.rawFetch.findUnique.mockResolvedValue({
      id: "x",
      rawHtml: "<html></html>",
      url: "https://example.com",
    });
    (extractContent as any).mockReturnValue({
      cleanText: "dup content",
      lowContent: false,
      method: "readability",
    });
    (extractMetadata as any).mockReturnValue({
      title: null,
      description: null,
      canonicalUrl: "https://example.com",
      publishedAt: null,
      domain: "example.com",
    });
    (computeContentHash as any).mockReturnValue("dup-hash");
    (computeSimhash as any).mockReturnValue("dup-simhash");
    prisma.document.create.mockRejectedValue({ code: "P2002" });

    await expect(
      processExtractionJob(makeJob({ rawFetchId: "x" }), prisma),
    ).resolves.not.toThrow();

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(enqueueNearDupCheck).not.toHaveBeenCalled();
    expect(prisma.rawFetch.update).toHaveBeenCalledWith({
      where: { id: "x" },
      data: { extracted: true },
    });
  });

  it("rethrows non-P2002 errors from document creation", async () => {
    prisma.rawFetch.findUnique.mockResolvedValue({
      id: "x",
      rawHtml: "<html></html>",
      url: "https://example.com",
    });
    (extractContent as any).mockReturnValue({
      cleanText: "content",
      lowContent: false,
      method: "readability",
    });
    (extractMetadata as any).mockReturnValue({
      title: null,
      description: null,
      canonicalUrl: "https://example.com",
      publishedAt: null,
      domain: "example.com",
    });
    (computeContentHash as any).mockReturnValue("hash");
    (computeSimhash as any).mockReturnValue("simhash");
    prisma.document.create.mockRejectedValue(new Error("connection lost"));

    await expect(
      processExtractionJob(makeJob({ rawFetchId: "x" }), prisma),
    ).rejects.toThrow("connection lost");
  });
});
