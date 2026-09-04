import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchUrl } from "../fetcher";

describe("fetchUrl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns correct shape on successful fetch", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: () => Promise.resolve("<html>hi</html>"),
    } as Response);

    const result = await fetchUrl("https://example.com/page");

    expect(result.statusCode).toBe(200);
    expect(result.domain).toBe("example.com");
    expect(result.rawHtml).toBe("<html>hi</html>");
    expect(result.headers["content-type"]).toBe("text/html");
    expect(result.extracted).toBe(false);
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it("captures non-200 status codes without throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 404,
      headers: new Headers(),
      text: () => Promise.resolve(""),
    } as Response);

    const result = await fetchUrl("https://example.com/missing");
    expect(result.statusCode).toBe(404);
  });

  it("throws when fetch itself rejects (network failure)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    await expect(fetchUrl("https://example.com")).rejects.toThrow(
      "network error",
    );
  });

  it("aborts and throws after timeout", async () => {
    vi.useFakeTimers();

    global.fetch = vi.fn().mockImplementation(
      (_url, opts: any) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const promise = fetchUrl("https://example.com/slow");
    const assertion = expect(promise).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(10000);
    await assertion;

    vi.useRealTimers();
  });

  it("parses domain correctly from a nested path URL", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(""),
    } as Response);

    const result = await fetchUrl("https://blog.example.com/2024/post");
    expect(result.domain).toBe("blog.example.com");
  });
});
