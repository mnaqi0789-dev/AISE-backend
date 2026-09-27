import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import Redis from "ioredis";
import {
  buildCacheKey,
  getCached,
  setCached,
  getWithStaleWhileRevalidate,
} from "../cache";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

describe("buildCacheKey", () => {
  it("produces the same key for identical inputs", () => {
    const input = {
      query: "test",
      lensId: "l1",
      domains: ["a.com", "b.com"],
      dateFrom: undefined,
      dateTo: undefined,
      page: 1,
      perPage: 20,
    };
    expect(buildCacheKey(input)).toBe(buildCacheKey({ ...input }));
  });

  it("is insensitive to query case and whitespace", () => {
    const a = buildCacheKey({
      query: "  Test  ",
      lensId: null,
      domains: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      page: 1,
      perPage: 20,
    });
    const b = buildCacheKey({
      query: "test",
      lensId: null,
      domains: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      page: 1,
      perPage: 20,
    });
    expect(a).toBe(b);
  });

  it("is insensitive to domain array ordering", () => {
    const a = buildCacheKey({
      query: "test",
      lensId: null,
      domains: ["b.com", "a.com"],
      dateFrom: undefined,
      dateTo: undefined,
      page: 1,
      perPage: 20,
    });
    const b = buildCacheKey({
      query: "test",
      lensId: null,
      domains: ["a.com", "b.com"],
      dateFrom: undefined,
      dateTo: undefined,
      page: 1,
      perPage: 20,
    });
    expect(a).toBe(b);
  });

  it("produces different keys for different lensId", () => {
    const a = buildCacheKey({
      query: "test",
      lensId: "l1",
      domains: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      page: 1,
      perPage: 20,
    });
    const b = buildCacheKey({
      query: "test",
      lensId: "l2",
      domains: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      page: 1,
      perPage: 20,
    });
    expect(a).not.toBe(b);
  });

  it("produces different keys for different pages", () => {
    const a = buildCacheKey({
      query: "test",
      lensId: null,
      domains: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      page: 1,
      perPage: 20,
    });
    const b = buildCacheKey({
      query: "test",
      lensId: null,
      domains: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      page: 2,
      perPage: 20,
    });
    expect(a).not.toBe(b);
  });
});

describe("getCached / setCached (integration, requires local Redis)", () => {
  const testKey = "search_cache:test_key_12345";

  beforeEach(async () => {
    await redis.del(testKey);
  });

  afterAll(async () => {
    await redis.del(testKey);
  });

  it("returns null for a key that was never set", async () => {
    expect(await getCached(testKey)).toBeNull();
  });

  it("returns the stored value after setCached", async () => {
    await setCached(testKey, { foo: "bar", count: 5 });
    expect(await getCached(testKey)).toEqual({ foo: "bar", count: 5 });
  });

  it("returns null for malformed JSON stored under the key", async () => {
    await redis.set(testKey, "{not valid json");
    expect(await getCached(testKey)).toBeNull();
  });
});

describe("getWithStaleWhileRevalidate (integration, requires local Redis)", () => {
  const testKey = "search_cache:swr_test_key";

  async function seedRawEntry(value: unknown, ageSeconds: number) {
    const entry = { value, computedAt: Date.now() - ageSeconds * 1000 };
    await redis.set(testKey, JSON.stringify(entry));
  }

  beforeEach(async () => {
    await redis.del(testKey);
  });

  afterAll(async () => {
    await redis.del(testKey);
    await redis.quit();
  });

  it("computes and caches on a genuine miss", async () => {
    const compute = vi.fn().mockResolvedValue({ result: "computed" });
    const { value, source } = await getWithStaleWhileRevalidate(
      testKey,
      compute,
    );

    expect(source).toBe("miss");
    expect(value).toEqual({ result: "computed" });
    expect(compute).toHaveBeenCalledOnce();
  });

  it("returns a fresh cached value without calling compute", async () => {
    await seedRawEntry({ result: "cached" }, 10);
    const compute = vi.fn().mockResolvedValue({ result: "should not be used" });

    const { value, source } = await getWithStaleWhileRevalidate(
      testKey,
      compute,
    );

    expect(source).toBe("fresh");
    expect(value).toEqual({ result: "cached" });
    expect(compute).not.toHaveBeenCalled();
  });

  it("returns a stale value immediately, and refreshes in the background", async () => {
    await seedRawEntry({ result: "old" }, 90);
    const compute = vi.fn().mockResolvedValue({ result: "refreshed" });

    const { value, source } = await getWithStaleWhileRevalidate(
      testKey,
      compute,
    );

    expect(source).toBe("stale");
    expect(value).toEqual({ result: "old" });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(compute).toHaveBeenCalledOnce();
    const raw = await redis.get(testKey);
    expect(JSON.parse(raw!).value).toEqual({ result: "refreshed" });
  });

  it("treats an entry beyond the grace window as a miss", async () => {
    await seedRawEntry({ result: "too old" }, 999);
    const compute = vi.fn().mockResolvedValue({ result: "fresh compute" });

    const { value, source } = await getWithStaleWhileRevalidate(
      testKey,
      compute,
    );

    expect(source).toBe("miss");
    expect(value).toEqual({ result: "fresh compute" });
    expect(compute).toHaveBeenCalledOnce();
  });
});
