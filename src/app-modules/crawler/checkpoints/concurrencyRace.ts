import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const DOMAIN_KEY = "race_test:example.com";
const MAX_ALLOWED = 5;

async function naiveTryAcquire(): Promise<boolean> {
  const current = await redis.get(DOMAIN_KEY);
  const count = current ? parseInt(current, 10) : 0;

  await new Promise((resolve) => setTimeout(resolve, 20));

  if (count >= MAX_ALLOWED) {
    return false;
  }

  await redis.set(DOMAIN_KEY, count + 1);
  return true;
}

async function atomicTryAcquire(): Promise<boolean> {
  const newCount = await redis.incr(DOMAIN_KEY);
  if (newCount > MAX_ALLOWED) {
    return false;
  }
  return true;
}

async function runTest(label: string, acquireFn: () => Promise<boolean>) {
  await redis.del(DOMAIN_KEY);

  const attempts = Array.from({ length: 20 }, () => acquireFn());
  const results = await Promise.all(attempts);

  const acceptedCount = results.filter((r) => r === true).length;

  console.log(`\n--- ${label} ---`);
  console.log(`Limit was: ${MAX_ALLOWED}`);
  console.log(`Actually accepted: ${acceptedCount}`);
  console.log(
    acceptedCount > MAX_ALLOWED
      ? `OVERSHOOT — race condition confirmed`
      : `Held the limit correctly`,
  );
}

async function main() {
  await runTest("Naive read-check-increment", naiveTryAcquire);
  await runTest("Atomic INCR", atomicTryAcquire);
  await redis.quit();
}

main();
