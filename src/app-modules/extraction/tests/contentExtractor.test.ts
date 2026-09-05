import { describe, it, expect } from "vitest";
import { extractContent } from "../contentExtractor";

const LONG_ARTICLE_HTML = `
<html>
<head><title>Test Article</title></head>
<body>
  <nav>Home | About | Contact</nav>
  <article>
    <p>${"This is a substantial paragraph of real article content. ".repeat(10)}</p>
    <p>${"Here is a second paragraph continuing the article body text. ".repeat(10)}</p>
  </article>
  <footer>Copyright 2026</footer>
</body>
</html>
`;

const TINY_HTML = `<html><body><p>Hi.</p></body></html>`;

describe("extractContent", () => {
  it("extracts substantial content via readability for a real article", () => {
    const result = extractContent(
      LONG_ARTICLE_HTML,
      "https://example.com/article",
    );
    expect(result.lowContent).toBe(false);
    expect(result.cleanText.length).toBeGreaterThan(200);
    expect(result.method).toBe("readability");
  });

  it("excludes nav/footer text from extracted content", () => {
    const result = extractContent(
      LONG_ARTICLE_HTML,
      "https://example.com/article",
    );
    expect(result.cleanText).not.toContain("Copyright 2026");
    expect(result.cleanText).not.toContain("Home | About | Contact");
  });

  it("flags low content for a near-empty page", () => {
    const result = extractContent(TINY_HTML, "https://example.com/tiny");
    expect(result.lowContent).toBe(true);
  });

  it("does not throw on malformed HTML", () => {
    const malformed = "<html><body><p>Unclosed paragraph<div>nested wrong";
    expect(() =>
      extractContent(malformed, "https://example.com/bad"),
    ).not.toThrow();
  });
});
