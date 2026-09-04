import * as cheerio from "cheerio";

export interface ExtractedMetadata {
  title: string | null;
  description: string | null;
  canonicalUrl: string;
  publishedAt: Date | null;
  domain: string;
}

export function extractMetadata(
  rawHtml: string,
  fetchedUrl: string,
): ExtractedMetadata {
  const $ = cheerio.load(rawHtml);
  const domain = new URL(fetchedUrl).hostname;

  const title =
    $("title").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    null;

  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    null;

  const canonicalHref = $('link[rel="canonical"]').attr("href");
  const canonicalUrl = canonicalHref
    ? new URL(canonicalHref, fetchedUrl).href
    : fetchedUrl;

  const publishedAt = extractPublishedDate($, rawHtml);

  return { title, description, canonicalUrl, publishedAt, domain };
}

function extractPublishedDate(
  $: cheerio.CheerioAPI,
  rawHtml: string,
): Date | null {
  const metaDate = $('meta[property="article:published_time"]').attr("content");
  if (metaDate) {
    const parsed = new Date(metaDate);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  const jsonLdDate = extractJsonLdDate($);
  if (jsonLdDate) return jsonLdDate;

  const regexMatch = rawHtml.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  if (regexMatch) {
    const parsed = new Date(regexMatch[0]);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function extractJsonLdDate($: cheerio.CheerioAPI): Date | null {
  const scripts = $('script[type="application/ld+json"]');

  for (const el of scripts.toArray()) {
    try {
      const json = JSON.parse($(el).text());
      const candidates = Array.isArray(json)
        ? json
        : json["@graph"]
          ? json["@graph"]
          : [json];

      for (const item of candidates) {
        if (item?.datePublished) {
          const parsed = new Date(item.datePublished);
          if (!isNaN(parsed.getTime())) return parsed;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}
