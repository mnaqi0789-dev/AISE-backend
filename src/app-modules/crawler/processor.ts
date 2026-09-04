import Redis from "ioredis";
import { Job, Queue } from "bullmq";
import { canCrawl } from "./robot";
import { fetchUrl } from "./fetcher";
import { extractLinks } from "./links";
import { filterNewUrls } from "./dedup";
import { isInScope } from "./seed";
import prisma from "../../db/prisma";

export interface CrawlJobData {
  url: string;
  domain: string;
  depth: number;
  lensId: string;
  maxDepth: number;
}

const USER_AGENT = "MyPersonalCrawler/1.0 (+https://example.com/bot-info)";

export const JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
};

export async function processCrawlJob(
  job: Job<CrawlJobData>,
  connection: Redis,
  crawlQueue: Queue<CrawlJobData>,
) {
  const { url, domain, depth, lensId, maxDepth } = job.data;

  const { isAllowed, crawlDelay } = await canCrawl(url, USER_AGENT);
  if (!isAllowed) {
    return;
  }

  if (crawlDelay) {
    const delayKey = `crawl_lock:${domain}`;
    const requiredDelayMs = crawlDelay * 1000;

    const acquired = await connection.set(
      delayKey,
      "1",
      "PX",
      requiredDelayMs,
      "NX",
    );

    if (!acquired) {
      const remainingMs = await connection.pttl(delayKey);
      await crawlQueue.add(job.name, job.data, {
        ...JOB_OPTS,
        delay: Math.max(remainingMs, 0),
      });
      return;
    }
  }

  const result = await fetchUrl(url);

  if (result.statusCode >= 400 && result.statusCode < 500) {
    await prisma.rawFetch.create({
      data: {
        url: result.url,
        domain: result.domain,
        statusCode: result.statusCode,
        headers: result.headers,
        rawHtml: result.rawHtml,
      },
    });
    return;
  }

  if (result.statusCode >= 500) {
    throw new Error(`HTTP ${result.statusCode} server error fetching ${url}`);
  }

  await prisma.rawFetch.create({
    data: {
      url: result.url,
      domain: result.domain,
      statusCode: result.statusCode,
      headers: result.headers,
      rawHtml: result.rawHtml,
    },
  });

  if (depth >= maxDepth) {
    return;
  }

  const lens = await prisma.lens.findUnique({ where: { id: lensId } });
  if (!lens) {
    return;
  }

  const links = extractLinks(result.rawHtml, url);
  const inScopeLinks = links.filter((link) => isInScope(link, lens.domains));
  const newLinks = await filterNewUrls(inScopeLinks);

  for (const link of newLinks) {
    const linkDomain = new URL(link).hostname;
    await crawlQueue.add(
      "crawlJob",
      { url: link, domain: linkDomain, depth: depth + 1, lensId, maxDepth },
      JOB_OPTS,
    );
  }
}
