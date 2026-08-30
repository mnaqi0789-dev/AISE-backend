import { URL } from "url";

interface FetchResult {
  url: string;
  domain: string;
  statusCode: number;
  headers: Record<string, string>;
  rawHtml: string;
  fetchedAt: Date;
  extracted: boolean;
}

const TIMEOUT_MS = 10000;
const USER_AGENT = "MyPersonalCrawler/1.0 (+https://example.com/bot-info)";

export async function fetchUrl(url: string): Promise<FetchResult> {
  const parsedUrl = new URL(url);
  const domain = parsedUrl.hostname;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });

    const rawHtml = await response.text();

    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    return {
      url,
      domain,
      statusCode: response.status,
      headers: headersObj,
      rawHtml,
      fetchedAt: new Date(),
      extracted: false,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
