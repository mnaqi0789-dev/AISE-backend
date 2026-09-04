import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./fetcher", () => ({ fetchUrl: vi.fn() }));

import { fetchUrl } from "./fetcher";
import { canCrawl } from "./robot";

describe("canCrawl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disallows a path matched by Disallow", async () => {
    (fetchUrl as any).mockResolvedValue({
      statusCode: 200,
      rawHtml: "User-agent: *\nDisallow: /private\n",
    });
    const result = await canCrawl(
      "https://example.com/private/page",
      "TestBot",
    );
    expect(result.isAllowed).toBe(false);
  });

  it("allows a path not matched by Disallow", async () => {
    (fetchUrl as any).mockResolvedValue({
      statusCode: 200,
      rawHtml: "User-agent: *\nDisallow: /private\n",
    });
    const result = await canCrawl("https://example.com/public/page", "TestBot");
    expect(result.isAllowed).toBe(true);
  });

  it("extracts crawl-delay", async () => {
    (fetchUrl as any).mockResolvedValue({
      statusCode: 200,
      rawHtml: "User-agent: *\nCrawl-delay: 5\n",
    });
    const result = await canCrawl("https://example.com/page", "TestBot");
    expect(result.crawlDelay).toBe(5);
  });

  it("defaults to allowed when robots.txt fetch throws", async () => {
    (fetchUrl as any).mockRejectedValue(new Error("timeout"));
    const result = await canCrawl("https://example.com/page", "TestBot");
    expect(result.isAllowed).toBe(true);
  });

  it("defaults to allowed when robots.txt returns non-200", async () => {
    (fetchUrl as any).mockResolvedValue({ statusCode: 404, rawHtml: "" });
    const result = await canCrawl("https://example.com/page", "TestBot");
    expect(result.isAllowed).toBe(true);
  });

  it("caches the parsed robots.txt across repeated calls to the same domain", async () => {
    (fetchUrl as any).mockResolvedValue({
      statusCode: 200,
      rawHtml: "User-agent: *\nDisallow: /private\n",
    });
    await canCrawl("https://example.com/page1", "TestBot");
    await canCrawl("https://example.com/page2", "TestBot");
    expect(fetchUrl).toHaveBeenCalledTimes(1);
  });
});
