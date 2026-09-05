import { describe, it, expect } from "vitest";
import { extractMetadata } from "../metadataExtractor";

describe("extractMetadata", () => {
  it("prefers <title> over og:title", () => {
    const html = `<html><head><title>Real Title</title><meta property="og:title" content="OG Title"></head></html>`;
    const result = extractMetadata(html, "https://example.com/page");
    expect(result.title).toBe("Real Title");
  });

  it("falls back to og:title when <title> is missing", () => {
    const html = `<html><head><meta property="og:title" content="OG Title"></head></html>`;
    const result = extractMetadata(html, "https://example.com/page");
    expect(result.title).toBe("OG Title");
  });

  it("falls back to og:description when meta description is missing", () => {
    const html = `<html><head><meta property="og:description" content="OG desc"></head></html>`;
    const result = extractMetadata(html, "https://example.com/page");
    expect(result.description).toBe("OG desc");
  });

  it("resolves a relative canonical URL against the fetched URL", () => {
    const html = `<html><head><link rel="canonical" href="/real-page"></head></html>`;
    const result = extractMetadata(html, "https://example.com/some/path");
    expect(result.canonicalUrl).toBe("https://example.com/real-page");
  });

  it("falls back to the fetched URL when no canonical tag exists", () => {
    const html = `<html><head></head></html>`;
    const result = extractMetadata(html, "https://example.com/page");
    expect(result.canonicalUrl).toBe("https://example.com/page");
  });

  it("extracts domain from the fetched URL", () => {
    const result = extractMetadata(
      "<html></html>",
      "https://blog.example.com/page",
    );
    expect(result.domain).toBe("blog.example.com");
  });

  it("prefers article:published_time over JSON-LD", () => {
    const html = `
      <html><head>
        <meta property="article:published_time" content="2026-01-15T10:00:00Z">
        <script type="application/ld+json">{"datePublished": "2025-06-01T00:00:00Z"}</script>
      </head></html>`;
    const result = extractMetadata(html, "https://example.com/page");
    expect(result.publishedAt?.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("falls back to JSON-LD datePublished when meta tag is missing", () => {
    const html = `<html><head><script type="application/ld+json">{"datePublished": "2025-06-01T00:00:00Z"}</script></head></html>`;
    const result = extractMetadata(html, "https://example.com/page");
    expect(result.publishedAt?.toISOString()).toBe("2025-06-01T00:00:00.000Z");
  });

  it("returns null publishedAt when no date signal exists", () => {
    const html = `<html><head></head></html>`;
    const result = extractMetadata(html, "https://example.com/page");
    expect(result.publishedAt).toBeNull();
  });

  it("does not throw on malformed JSON-LD", () => {
    const html = `<html><head><script type="application/ld+json">{not valid json</script></head></html>`;
    expect(() =>
      extractMetadata(html, "https://example.com/page"),
    ).not.toThrow();
  });
});
