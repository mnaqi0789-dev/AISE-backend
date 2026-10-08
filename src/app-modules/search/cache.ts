import { createHash } from "crypto";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const FRESH_TTL_SECONDS = 60;
const GRACE_TTL_SECONDS = 300;
const NEGATIVE_TTL_SECONDS = 15;
const CACHE_PREFIX = "search_cache:";
const LOCK_PREFIX = "search_lock:";
const LOCK_TTL_MS = 10000;
const POLL_INTERVAL_MS = 100;
const POLL_TIMEOUT_MS = 5000;

export interface CacheKeyInput {
  query: string;
  lensId: string | null;
  domains: string[] | undefined;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  page: number;
  perPage: number;
}

export function buildCacheKey(input: CacheKeyInput): string {
  const normalized = JSON.stringify({
    query: input.query.toLowerCase().trim(),
    lensId: input.lensId,
    domains: input.domains ? [...input.domains].sort() : null,
    dateFrom: input.dateFrom?.toISOString() ?? null,
    dateTo: input.dateTo?.toISOString() ?? null,
    page: input.page,
    perPage: input.perPage,
  });

  const hash = createHash("sha256").update(normalized).digest("hex");
  return `${CACHE_PREFIX}${hash}`;
}

export async function getCached<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setCached<T>(key: string, value: T): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", FRESH_TTL_SECONDS);
}

interface CacheEntry<T> {
  value: T;
  computedAt: number;
  ttlSeconds: number;
}

export type CacheSource = "fresh" | "stale" | "miss";
export type TtlSelector<T> = (value: T) => number;

const defaultTtlSelector = () => FRESH_TTL_SECONDS + GRACE_TTL_SECONDS;

async function acquireLock(lockKey: string): Promise<boolean> {
  const result = await redis.set(lockKey, "1", "PX", LOCK_TTL_MS, "NX");
  return result === "OK";
}

async function releaseLock(lockKey: string): Promise<void> {
  await redis.del(lockKey);
}

async function pollForEntry<T>(
  key: string,
  timeoutMs: number,
): Promise<CacheEntry<T> | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const raw = await redis.get(key);
    if (raw) {
      try {
        return JSON.parse(raw) as CacheEntry<T>;
      } catch {
        return null;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return null;
}

export async function getWithStaleWhileRevalidate<T>(
  key: string,
  compute: () => Promise<T>,
  getTtlSeconds: TtlSelector<T> = defaultTtlSelector,
): Promise<{ value: T; source: CacheSource }> {
  const raw = await redis.get(key);

  if (raw) {
    try {
      const entry: CacheEntry<T> = JSON.parse(raw);
      const ageSeconds = (Date.now() - entry.computedAt) / 1000;
      const freshWindow = Math.min(entry.ttlSeconds, FRESH_TTL_SECONDS);

      if (ageSeconds <= freshWindow) {
        return { value: entry.value, source: "fresh" };
      }

      if (ageSeconds <= entry.ttlSeconds) {
        void refreshInBackgroundIfUnlocked(key, compute, getTtlSeconds);
        return { value: entry.value, source: "stale" };
      }
    } catch {
    }
  }

  return computeWithLock(key, compute, getTtlSeconds);
}

async function computeWithLock<T>(
  key: string,
  compute: () => Promise<T>,
  getTtlSeconds: TtlSelector<T>,
): Promise<{ value: T; source: CacheSource }> {
  const lockKey = `${LOCK_PREFIX}${key}`;
  const acquired = await acquireLock(lockKey);

  if (acquired) {
    try {
      const value = await compute();
      await setCacheEntry(key, value, getTtlSeconds(value));
      return { value, source: "miss" };
    } finally {
      await releaseLock(lockKey);
    }
  }

  const waited = await pollForEntry<T>(key, POLL_TIMEOUT_MS);
  if (waited) {
    return { value: waited.value, source: "miss" };
  }

  const value = await compute();
  await setCacheEntry(key, value, getTtlSeconds(value));
  return { value, source: "miss" };
}

async function refreshInBackgroundIfUnlocked<T>(
  key: string,
  compute: () => Promise<T>,
  getTtlSeconds: TtlSelector<T>,
): Promise<void> {
  const lockKey = `${LOCK_PREFIX}${key}`;
  const acquired = await acquireLock(lockKey);
  if (!acquired) return;

  try {
    const value = await compute();
    await setCacheEntry(key, value, getTtlSeconds(value));
  } catch {
  } finally {
    await releaseLock(lockKey);
  }
}

async function setCacheEntry<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  const entry: CacheEntry<T> = { value, computedAt: Date.now(), ttlSeconds };
  await redis.set(key, JSON.stringify(entry), "EX", ttlSeconds);
}

export { NEGATIVE_TTL_SECONDS, FRESH_TTL_SECONDS };
