import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const CRAWLED_URLS_KEY = "crawled_urls";

export async function isNewUrl(url: string): Promise<boolean> {
  const addedCount = await redis.sadd(CRAWLED_URLS_KEY, url);
  return addedCount === 1;
}

export async function filterNewUrls(urls: string[]): Promise<string[]> {
  if (urls.length === 0) {
    return [];
  }

  const pipeline = redis.pipeline();
  for (const url of urls) {
    pipeline.sadd(CRAWLED_URLS_KEY, url);
  }

  const results = await pipeline.exec();
  if (!results) {
    return [];
  }

  const newUrls: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const [err, addedCount] = results[i];
    if (!err && addedCount === 1) {
      newUrls.push(urls[i]);
    }
  }

  return newUrls;
}
