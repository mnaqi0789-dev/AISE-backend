import { describe, it, expect } from "vitest";
import { extractLinks } from "../links";

describe("extractLinks", () => {
  it("resolves relative links to absolute", () => {
    const html = `<a href="/page">link</a>`;
    const result = extractLinks(html, "https://example.com/blog");
    expect(result).toContain("https://example.com/page");
  });

  it("strips tracking params", () => {
    const html = `<a href="https://example.com/page?utm_source=x&id=5">link</a>`;
    const result = extractLinks(html, "https://example.com");
    expect(result).toContain("https://example.com/page?id=5");
  });

  it("strips hash fragments", () => {
    const html = `<a href="https://example.com/page#section">link</a>`;
    const result = extractLinks(html, "https://example.com");
    expect(result).toContain("https://example.com/page");
  });

  it("ignores mailto and javascript links", () => {
    const html = `
      <a href="mailto:test@example.com">mail</a>
      <a href="javascript:void(0)">js</a>
      <a href="https://example.com/real">real</a>
    `;
    const result = extractLinks(html, "https://example.com");
    expect(result).toEqual(["https://example.com/real"]);
  });

  it("removes trailing slash except root", () => {
    const html = `
      <a href="https://example.com/page/">a</a>
      <a href="https://example.com/">b</a>
    `;
    const result = extractLinks(html, "https://example.com");
    expect(result).toContain("https://example.com/page");
    expect(result).toContain("https://example.com/");
  });

  it("deduplicates identical resolved links", () => {
    const html = `
      <a href="/page">a</a>
      <a href="/page">b</a>
    `;
    const result = extractLinks(html, "https://example.com");
    expect(result.filter((u) => u === "https://example.com/page").length).toBe(
      1,
    );
  });

  it("sorts query params for consistent normalization", () => {
    const html = `<a href="https://example.com/page?b=2&a=1">link</a>`;
    const result = extractLinks(html, "https://example.com");
    expect(result).toContain("https://example.com/page?a=1&b=2");
  });
});
