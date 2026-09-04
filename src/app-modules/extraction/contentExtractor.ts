import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";

const MIN_CONTENT_LENGTH = 200;

export interface ExtractedContent {
  cleanText: string;
  lowContent: boolean;
  method: "readability" | "fallback";
}

export function extractContent(rawHtml: string, url: string): ExtractedContent {
  const readabilityResult = tryReadability(rawHtml, url);

  if (readabilityResult && readabilityResult.length >= MIN_CONTENT_LENGTH) {
    return {
      cleanText: readabilityResult,
      lowContent: false,
      method: "readability",
    };
  }

  const fallbackResult = structuralFallback(rawHtml);

  return {
    cleanText: fallbackResult,
    lowContent: fallbackResult.length < MIN_CONTENT_LENGTH,
    method: "fallback",
  };
}

function tryReadability(rawHtml: string, url: string): string | null {
  try {
    const dom = new JSDOM(rawHtml, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent) {
      return null;
    }

    return article.textContent.trim();
  } catch {
    return null;
  }
}

function structuralFallback(rawHtml: string): string {
  const $ = cheerio.load(rawHtml);

  $("nav, footer, script, style, aside").remove();

  const containers =
    $("article, main").length > 0 ? $("article, main") : $("body");

  return containers.text().replace(/\s+/g, " ").trim();
}
