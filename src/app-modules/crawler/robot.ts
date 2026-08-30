import robotsParser from "robots-parser";
import { fetchUrl } from "./fetcher";

interface RobotsCheckResult {
  isAllowed: boolean;
  crawlDelay: number | null;
}

const robotsCache = new Map<
  string,
  { parser: ReturnType<typeof robotsParser>; expiresAt: number }
>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function canCrawl(
  url: string,
  userAgent: string,
): Promise<RobotsCheckResult> {
  const parsedUrl = new URL(url);
  const domain = parsedUrl.hostname;
  const robotsUrl = `${parsedUrl.protocol}//${domain}/robots.txt`;

  const now = Date.now();
  const cached = robotsCache.get(domain);

  let parser: ReturnType<typeof robotsParser>;

  if (cached && cached.expiresAt > now) {
    parser = cached.parser;
  } else {
    try {
      const result = await fetchUrl(robotsUrl);
      const body = result.statusCode === 200 ? result.rawHtml : "";
      parser = robotsParser(robotsUrl, body);
    } catch {
      parser = robotsParser(robotsUrl, "");
    }

    robotsCache.set(domain, {
      parser,
      expiresAt: now + CACHE_TTL_MS,
    });
  }

  const isAllowed = parser.isAllowed(url, userAgent) ?? true;
  const crawlDelay = parser.getCrawlDelay(userAgent) ?? null;

  return {
    isAllowed,
    crawlDelay,
  };
}
