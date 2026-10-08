import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const LOCK_PREFIX = "live_fetch_lock:";
const LOCK_TTL_MS = 15000;
const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 8000;

function lockKeyFor(url: string): string {
  return `${LOCK_PREFIX}${url}`;
}

export async function claimLiveFetch(url: string): Promise<boolean> {
  const result = await redis.set(lockKeyFor(url), "1", "PX", LOCK_TTL_MS, "NX");
  return result === "OK";
}

export async function releaseLiveFetch(url: string): Promise<void> {
  await redis.del(lockKeyFor(url));
}

export async function waitForLiveFetch(
  url: string,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const stillLocked = await redis.get(lockKeyFor(url));
    if (!stillLocked) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return false;
}
