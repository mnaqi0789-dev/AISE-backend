import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { isNewUrl, filterNewUrls } from "./dedup";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

describe("dedup (integration, requires local Redis)", () => {
  beforeEach(async () => {
    await redis.del("crawled_urls");
  });

  afterAll(async () => {
    await redis.del("crawled_urls");
    await redis.quit();
  });

  it("returns true the first time a URL is seen", async () => {
    expect(await isNewUrl("https://example.com/a")).toBe(true);
  });

  it("returns false for a URL already added", async () => {
    await isNewUrl("https://example.com/a");
    expect(await isNewUrl("https://example.com/a")).toBe(false);
  });

  it("filterNewUrls excludes previously seen URLs", async () => {
    await isNewUrl("https://example.com/a");
    const result = await filterNewUrls([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(result).toEqual(["https://example.com/b"]);
  });

  it("filterNewUrls dedups repeated entries within the same batch", async () => {
    const result = await filterNewUrls([
      "https://example.com/c",
      "https://example.com/c",
    ]);
    expect(result).toEqual(["https://example.com/c"]);
  });

  it("only lets one concurrent call through for the same URL", async () => {
    const results = await Promise.all([
      isNewUrl("https://example.com/race"),
      isNewUrl("https://example.com/race"),
      isNewUrl("https://example.com/race"),
    ]);
    expect(results.filter((r) => r === true).length).toBe(1);
  });
});
