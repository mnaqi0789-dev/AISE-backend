import * as cheerio from "cheerio";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "msclkid",
  "_hsenc",
  "_hsmi",
  "mc_cid",
  "mc_eid",
]);

const IGNORED_PROTOCOLS = [
  "mailto:",
  "tel:",
  "javascript:",
  "data:",
  "vbscript:",
];

export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const linksSet = new Set<string>();

  $("a[href]").each((_, element) => {
    const rawHref = $(element).attr("href")?.trim();

    if (!rawHref || rawHref.startsWith("#")) {
      return;
    }

    const lowerHref = rawHref.toLowerCase();
    if (IGNORED_PROTOCOLS.some((protocol) => lowerHref.startsWith(protocol))) {
      return;
    }

    try {
      const resolvedUrl = new URL(rawHref, baseUrl);

      if (
        resolvedUrl.protocol !== "http:" &&
        resolvedUrl.protocol !== "https:"
      ) {
        return;
      }

      resolvedUrl.hash = "";

      for (const param of Array.from(resolvedUrl.searchParams.keys())) {
        if (TRACKING_PARAMS.has(param.toLowerCase())) {
          resolvedUrl.searchParams.delete(param);
        }
      }

      resolvedUrl.searchParams.sort();

      if (
        resolvedUrl.pathname.length > 1 &&
        resolvedUrl.pathname.endsWith("/")
      ) {
        resolvedUrl.pathname = resolvedUrl.pathname.slice(0, -1);
      }

      linksSet.add(resolvedUrl.href);
    } catch {
      return;
    }
  });

  return Array.from(linksSet);
}
