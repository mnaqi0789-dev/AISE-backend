import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import {
  claimLiveFetch,
  releaseLiveFetch,
  waitForLiveFetch,
} from "../liveFetchLock";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const testUrl = "https://example.com/live-fetch-lock-test-page";
const lockKey = `live_fetch_lock:${testUrl}`;

describe("claimLiveFetch / releaseLiveFetch (integration, requires local Redis)", () => {
  beforeEach(async () => {
    await redis.del(lockKey);
  });

  afterAll(async () => {
    await redis.del(lockKey);
  });

  it("claims the lock when it is not already held", async () => {
    expect(await claimLiveFetch(testUrl)).toBe(true);
  });

  it("refuses a second claim while the lock is held", async () => {
    await claimLiveFetch(testUrl);
    expect(await claimLiveFetch(testUrl)).toBe(false);
  });

  it("allows claiming again after an explicit release", async () => {
    await claimLiveFetch(testUrl);
    await releaseLiveFetch(testUrl);
    expect(await claimLiveFetch(testUrl)).toBe(true);
  });

  it("locks different URLs independently", async () => {
    const otherUrl = "https://example.com/a-different-page";
    await redis.del(`live_fetch_lock:${otherUrl}`);

    expect(await claimLiveFetch(testUrl)).toBe(true);
    expect(await claimLiveFetch(otherUrl)).toBe(true);

    await redis.del(`live_fetch_lock:${otherUrl}`);
  });
});

describe("waitForLiveFetch (integration, requires local Redis)", () => {
  beforeEach(async () => {
    await redis.del(lockKey);
  });

  afterAll(async () => {
    await redis.del(lockKey);
  });

  it("returns true immediately when the lock is already free", async () => {
    expect(await waitForLiveFetch(testUrl, 1000)).toBe(true);
  });

  it("returns true once a held lock is released before the timeout", async () => {
    await claimLiveFetch(testUrl);
    setTimeout(() => releaseLiveFetch(testUrl), 150);

    expect(await waitForLiveFetch(testUrl, 2000)).toBe(true);
  });

  it("returns false when the lock is still held past the timeout", async () => {
    await claimLiveFetch(testUrl);
    expect(await waitForLiveFetch(testUrl, 300)).toBe(false);
  });
});

afterAll(async () => {
  await redis.quit();
});
