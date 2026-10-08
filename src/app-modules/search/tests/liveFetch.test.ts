import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db/prisma", () => ({
  default: {
    document: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));
vi.mock("../../crawler/fetcher", () => ({ fetchUrl: vi.fn() }));
vi.mock("../../extraction/contentExtractor", () => ({
  extractContent: vi.fn(),
}));
vi.mock("../../extraction/metadataExtractor", () => ({
  extractMetadata: vi.fn(),
}));
vi.mock("../../extraction/hashing", () => ({
  computeContentHash: vi.fn(),
  computeSimhash: vi.fn(),
}));
vi.mock("../../extraction/nearDupQueue", () => ({
  enqueueNearDupCheck: vi.fn(),
}));
vi.mock("../liveFetchLock", () => ({
  claimLiveFetch: vi.fn(),
  releaseLiveFetch: vi.fn(),
  waitForLiveFetch: vi.fn(),
}));

import prisma from "../../../db/prisma";
import { fetchUrl } from "../../crawler/fetcher";
import { extractContent } from "../../extraction/contentExtractor";
import { extractMetadata } from "../../extraction/metadataExtractor";
import { computeContentHash, computeSimhash } from "../../extraction/hashing";
import { enqueueNearDupCheck } from "../../extraction/nearDupQueue";
import {
  claimLiveFetch,
  releaseLiveFetch,
  waitForLiveFetch,
} from "../liveFetchLock";
import { liveFetchUrl } from "../liveFetch";

const URL = "https://example.com/article";

function freshMetadata(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: "T",
    description: "D",
    canonicalUrl: URL,
    publishedAt: null,
    domain: "example.com",
    ...overrides,
  };
}

describe("liveFetchUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns already_indexed without touching the lock when a document already exists", async () => {
    (prisma.document.findUnique as any).mockResolvedValue({ id: "doc1" });

    const result = await liveFetchUrl(URL);

    expect(result).toEqual({ status: "already_indexed", documentId: "doc1" });
    expect(claimLiveFetch).not.toHaveBeenCalled();
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it("waits and returns the document once a concurrent fetch finishes", async () => {
    (prisma.document.findUnique as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "doc2" });
    (claimLiveFetch as any).mockResolvedValue(false);
    (waitForLiveFetch as any).mockResolvedValue(true);

    const result = await liveFetchUrl(URL);

    expect(result).toEqual({ status: "waited", documentId: "doc2" });
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it("returns failed if the wait clears but no document shows up", async () => {
    (prisma.document.findUnique as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    (claimLiveFetch as any).mockResolvedValue(false);
    (waitForLiveFetch as any).mockResolvedValue(true);

    const result = await liveFetchUrl(URL);

    expect(result).toEqual({ status: "failed", documentId: null });
  });

  it("returns timed_out when the lock never clears", async () => {
    (prisma.document.findUnique as any).mockResolvedValue(null);
    (claimLiveFetch as any).mockResolvedValue(false);
    (waitForLiveFetch as any).mockResolvedValue(false);

    const result = await liveFetchUrl(URL);

    expect(result).toEqual({ status: "timed_out", documentId: null });
  });

  it("returns failed and releases the lock on a non-2xx fetch status", async () => {
    (prisma.document.findUnique as any).mockResolvedValue(null);
    (claimLiveFetch as any).mockResolvedValue(true);
    (fetchUrl as any).mockResolvedValue({ statusCode: 404, rawHtml: "" });

    const result = await liveFetchUrl(URL);

    expect(result).toEqual({ status: "failed", documentId: null });
    expect(releaseLiveFetch).toHaveBeenCalledWith(URL);
  });

  it("returns failed and releases the lock on low-content extraction", async () => {
    (prisma.document.findUnique as any).mockResolvedValue(null);
    (claimLiveFetch as any).mockResolvedValue(true);
    (fetchUrl as any).mockResolvedValue({
      statusCode: 200,
      rawHtml: "<html></html>",
    });
    (extractContent as any).mockReturnValue({
      cleanText: "",
      lowContent: true,
      method: "fallback",
    });

    const result = await liveFetchUrl(URL);

    expect(result).toEqual({ status: "failed", documentId: null });
    expect(releaseLiveFetch).toHaveBeenCalledWith(URL);
  });

  it("fetches, extracts, saves, enqueues the near-dup check, and releases the lock on success", async () => {
    (prisma.document.findUnique as any).mockResolvedValue(null);
    (claimLiveFetch as any).mockResolvedValue(true);
    (fetchUrl as any).mockResolvedValue({
      statusCode: 200,
      rawHtml: "<html>real</html>",
    });
    (extractContent as any).mockReturnValue({
      cleanText: "real content",
      lowContent: false,
      method: "readability",
    });
    (extractMetadata as any).mockReturnValue(freshMetadata());
    (computeContentHash as any).mockReturnValue("hash1");
    (computeSimhash as any).mockReturnValue("sim1");
    (prisma.document.create as any).mockResolvedValue({ id: "newdoc" });

    const result = await liveFetchUrl(URL);

    expect(result).toEqual({ status: "fetched", documentId: "newdoc" });
    expect(prisma.document.create).toHaveBeenCalledOnce();
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(enqueueNearDupCheck).toHaveBeenCalledWith("newdoc", "sim1");
    expect(releaseLiveFetch).toHaveBeenCalledWith(URL);
  });

  it("treats a P2002 unique-constraint race as already_indexed when the duplicate can be found", async () => {
    (prisma.document.findUnique as any).mockResolvedValue(null);
    (claimLiveFetch as any).mockResolvedValue(true);
    (fetchUrl as any).mockResolvedValue({
      statusCode: 200,
      rawHtml: "<html></html>",
    });
    (extractContent as any).mockReturnValue({
      cleanText: "dup content",
      lowContent: false,
      method: "readability",
    });
    (extractMetadata as any).mockReturnValue(freshMetadata());
    (computeContentHash as any).mockReturnValue("duphash");
    (computeSimhash as any).mockReturnValue("dupsim");
    (prisma.document.create as any).mockRejectedValue({ code: "P2002" });
    (prisma.document.findFirst as any).mockResolvedValue({ id: "existingdoc" });

    const result = await liveFetchUrl(URL);

    expect(result).toEqual({
      status: "already_indexed",
      documentId: "existingdoc",
    });
    expect(releaseLiveFetch).toHaveBeenCalledWith(URL);
  });

  it("returns failed, not a thrown error, when the duplicate from a P2002 race cannot be found", async () => {
    (prisma.document.findUnique as any).mockResolvedValue(null);
    (claimLiveFetch as any).mockResolvedValue(true);
    (fetchUrl as any).mockResolvedValue({
      statusCode: 200,
      rawHtml: "<html></html>",
    });
    (extractContent as any).mockReturnValue({
      cleanText: "dup content",
      lowContent: false,
      method: "readability",
    });
    (extractMetadata as any).mockReturnValue(freshMetadata());
    (computeContentHash as any).mockReturnValue("duphash");
    (computeSimhash as any).mockReturnValue("dupsim");
    (prisma.document.create as any).mockRejectedValue({ code: "P2002" });
    (prisma.document.findFirst as any).mockResolvedValue(null);

    const result = await liveFetchUrl(URL);

    expect(result).toEqual({ status: "failed", documentId: null });
  });

  it("swallows a non-P2002 error from document.create as failed instead of throwing", async () => {
    (prisma.document.findUnique as any).mockResolvedValue(null);
    (claimLiveFetch as any).mockResolvedValue(true);
    (fetchUrl as any).mockResolvedValue({
      statusCode: 200,
      rawHtml: "<html></html>",
    });
    (extractContent as any).mockReturnValue({
      cleanText: "content",
      lowContent: false,
      method: "readability",
    });
    (extractMetadata as any).mockReturnValue(freshMetadata());
    (computeContentHash as any).mockReturnValue("hash");
    (computeSimhash as any).mockReturnValue("simhash");
    (prisma.document.create as any).mockRejectedValue(
      new Error("connection lost"),
    );

    await expect(liveFetchUrl(URL)).resolves.toEqual({
      status: "failed",
      documentId: null,
    });
    expect(releaseLiveFetch).toHaveBeenCalledWith(URL);
  });

  it("never throws out of the function on a network failure, and still releases the lock", async () => {
    (prisma.document.findUnique as any).mockResolvedValue(null);
    (claimLiveFetch as any).mockResolvedValue(true);
    (fetchUrl as any).mockRejectedValue(new Error("network exploded"));

    await expect(liveFetchUrl(URL)).resolves.toEqual({
      status: "failed",
      documentId: null,
    });
    expect(releaseLiveFetch).toHaveBeenCalledWith(URL);
  });
});
