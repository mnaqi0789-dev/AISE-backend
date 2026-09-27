import { createHash } from "crypto";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const FRESH_TTL_SECONDS = 60;
const GRACE_TTL_SECONDS = 300;
const CACHE_PREFIX = "search_cache:";

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
}

export type CacheSource = "fresh" | "stale" | "miss";

export async function getWithStaleWhileRevalidate<T>(
  key: string,
  compute: () => Promise<T>,
): Promise<{ value: T; source: CacheSource }> {
  const raw = await redis.get(key);

  if (raw) {
    try {
      const entry: CacheEntry<T> = JSON.parse(raw);
      const ageSeconds = (Date.now() - entry.computedAt) / 1000;

      if (ageSeconds <= FRESH_TTL_SECONDS) {
        return { value: entry.value, source: "fresh" };
      }

      if (ageSeconds <= FRESH_TTL_SECONDS + GRACE_TTL_SECONDS) {
        void refreshInBackground(key, compute);
        return { value: entry.value, source: "stale" };
      }
    } catch {
      // malformed entry, fall through to recompute
    }
  }

  const value = await compute();
  await setCacheEntry(key, value);
  return { value, source: "miss" };
}

async function refreshInBackground<T>(key: string, compute: () => Promise<T>): Promise<void> {
  try {
    const value = await compute();
    await setCacheEntry(key, value);
  } catch {
  }
}

async function setCacheEntry<T>(key: string, value: T): Promise<void> {
  const entry: CacheEntry<T> = { value, computedAt: Date.now() };
  await redis.set(key, JSON.stringify(entry), "EX", FRESH_TTL_SECONDS + GRACE_TTL_SECONDS);
}