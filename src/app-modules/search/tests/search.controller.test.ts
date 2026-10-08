import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../../indexing/search", () => ({
  searchDocuments: vi.fn(),
  countSearchResults: vi.fn(),
}));
vi.mock("../lensResolver", () => ({ resolveLens: vi.fn() }));
vi.mock("../liveFetch", () => ({ liveFetchUrl: vi.fn() }));
vi.mock("../cache", () => ({
  buildCacheKey: vi.fn(() => "cache-key"),
  getWithStaleWhileRevalidate: vi.fn(),
  NEGATIVE_TTL_SECONDS: 15,
  FRESH_TTL_SECONDS: 60,
}));

import { searchDocuments, countSearchResults } from "../../indexing/search";
import { resolveLens } from "../lensResolver";
import { liveFetchUrl } from "../liveFetch";
import { getWithStaleWhileRevalidate } from "../cache";
import { search } from "../search.controller";

function makeReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

function makeRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("search controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (resolveLens as any).mockResolvedValue({
      lensId: null,
      lensName: "all",
      lensMode: "all",
      domains: null,
    });
    (getWithStaleWhileRevalidate as any).mockImplementation(
      async (_key: string, compute: () => Promise<any>) => ({
        value: await compute(),
        source: "miss",
      }),
    );
  });

  it("responds 400 when the query parameter is missing", async () => {
    const req = makeReq({});
    const res = makeRes();

    await search(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(liveFetchUrl).not.toHaveBeenCalled();
  });

  it("does not live-fetch when results already meet the thin-results threshold", async () => {
    (searchDocuments as any).mockResolvedValue([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    (countSearchResults as any).mockResolvedValue({
      count: 3,
      isApproximate: false,
    });

    const req = makeReq({ q: "test", live_url: "https://example.com/x" });
    const res = makeRes();

    await search(req, res);

    expect(liveFetchUrl).not.toHaveBeenCalled();
    expect(searchDocuments).toHaveBeenCalledOnce();
    const body = (res.json as any).mock.calls[0][0];
    expect(body.source).toBe("index");
  });

  it("returns thin results as-is when no live_url is given", async () => {
    (searchDocuments as any).mockResolvedValue([{ id: 1 }]);
    (countSearchResults as any).mockResolvedValue({
      count: 1,
      isApproximate: false,
    });

    const req = makeReq({ q: "rare query" });
    const res = makeRes();

    await search(req, res);

    expect(liveFetchUrl).not.toHaveBeenCalled();
    const body = (res.json as any).mock.calls[0][0];
    expect(body.source).toBe("index");
    expect(body.raw_results).toHaveLength(1);
  });

  it("live-fetches and retries the search when results are thin and live_url is given", async () => {
    (searchDocuments as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    (countSearchResults as any)
      .mockResolvedValueOnce({ count: 0, isApproximate: false })
      .mockResolvedValueOnce({ count: 2, isApproximate: false });
    (liveFetchUrl as any).mockResolvedValue({
      status: "fetched",
      documentId: "doc1",
    });

    const req = makeReq({
      q: "niche topic",
      live_url: "https://example.com/article",
    });
    const res = makeRes();

    await search(req, res);

    expect(liveFetchUrl).toHaveBeenCalledWith("https://example.com/article");
    expect(searchDocuments).toHaveBeenCalledTimes(2);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.source).toBe("live_fetch");
    expect(body.raw_results).toHaveLength(2);
  });

  it("falls back to the original thin results when the live fetch times out", async () => {
    (searchDocuments as any).mockResolvedValue([{ id: 1 }]);
    (countSearchResults as any).mockResolvedValue({
      count: 1,
      isApproximate: false,
    });
    (liveFetchUrl as any).mockResolvedValue({
      status: "timed_out",
      documentId: null,
    });

    const req = makeReq({
      q: "niche topic",
      live_url: "https://example.com/article",
    });
    const res = makeRes();

    await search(req, res);

    expect(searchDocuments).toHaveBeenCalledTimes(1);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.source).toBe("index");
  });

  it("falls back to the original thin results when the live fetch fails", async () => {
    (searchDocuments as any).mockResolvedValue([]);
    (countSearchResults as any).mockResolvedValue({
      count: 0,
      isApproximate: false,
    });
    (liveFetchUrl as any).mockResolvedValue({
      status: "failed",
      documentId: null,
    });

    const req = makeReq({
      q: "niche topic",
      live_url: "https://example.com/article",
    });
    const res = makeRes();

    await search(req, res);

    expect(searchDocuments).toHaveBeenCalledTimes(1);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.source).toBe("index");
  });

  it("reports the response source as cache when served from a fresh cache hit, regardless of the cached value's own source", async () => {
    (getWithStaleWhileRevalidate as any).mockResolvedValue({
      value: {
        query: "test",
        lens: "all",
        lens_mode: "all",
        raw_results: [{ id: 1 }],
        synthesized_answer: null,
        pagination: { page: 1, per_page: 20, approx_total: "1" },
        source: "live_fetch",
      },
      source: "fresh",
    });

    const req = makeReq({ q: "test" });
    const res = makeRes();

    await search(req, res);

    const body = (res.json as any).mock.calls[0][0];
    expect(body.source).toBe("cache");
    expect(searchDocuments).not.toHaveBeenCalled();
  });

  it("passes an empty domain filter to the query when the requested domain is outside the lens scope", async () => {
    (resolveLens as any).mockResolvedValue({
      lensId: "lens1",
      lensName: "Dev",
      lensMode: "predefined",
      domains: ["developer.mozilla.org"],
    });
    (searchDocuments as any).mockResolvedValue([]);
    (countSearchResults as any).mockResolvedValue({
      count: 0,
      isApproximate: false,
    });

    const req = makeReq({ q: "test", lens: "Dev", domain: "unrelated.com" });
    const res = makeRes();

    await search(req, res);

    expect(searchDocuments).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({ domains: [] }),
    );
  });
});
