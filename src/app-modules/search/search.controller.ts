import { Request, Response } from "express";
import { searchDocuments, countSearchResults } from "../indexing/search";
import { resolveLens } from "./lensResolver";
import { liveFetchUrl } from "./liveFetch";
import {
  buildCacheKey,
  getWithStaleWhileRevalidate,
  NEGATIVE_TTL_SECONDS,
  FRESH_TTL_SECONDS,
} from "./cache";

const THIN_RESULTS_THRESHOLD = 3;
const RETRIABLE_LIVE_FETCH_STATUSES = new Set([
  "fetched",
  "waited",
  "already_indexed",
]);

function intersectDomains(
  lensDomains: string[] | null,
  filterDomain: string | undefined,
): string[] | undefined {
  if (!filterDomain) {
    return lensDomains ?? undefined;
  }

  if (!lensDomains) {
    return [filterDomain];
  }

  return lensDomains.includes(filterDomain) ? [filterDomain] : [];
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? undefined : parsed;
}

interface SearchResponseBody {
  query: string;
  lens: string;
  lens_mode: string;
  raw_results: unknown[];
  synthesized_answer: null;
  pagination: { page: number; per_page: number; approx_total: string };
  source: "index" | "live_fetch" | "cache";
}

export async function search(req: Request, res: Response) {
  const query = (req.query.q as string)?.trim();
  const lensParam = req.query.lens as string | undefined;
  const domainParam = req.query.domain as string | undefined;
  const liveUrlParam = (req.query.live_url as string | undefined)?.trim();
  const dateFrom = parseDate(req.query.date_from as string | undefined);
  const dateTo = parseDate(req.query.date_to as string | undefined);
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const perPage = Math.min(
    50,
    Math.max(1, parseInt((req.query.per_page as string) || "20", 10)),
  );

  if (!query) {
    return res.status(400).json({ message: "Query parameter 'q' is required" });
  }

  const resolvedLens = await resolveLens(lensParam);
  const domains = intersectDomains(resolvedLens.domains, domainParam);

  const cacheKey = buildCacheKey({
    query,
    lensId: resolvedLens.lensId,
    domains,
    dateFrom,
    dateTo,
    page,
    perPage,
  });
  const searchOptions = {
    domains,
    dateFrom,
    dateTo,
    limit: perPage,
    offset: (page - 1) * perPage,
  };

  async function runSearch(): Promise<{
    results: unknown[];
    approxTotal: string;
  }> {
    const [results, { count, isApproximate }] = await Promise.all([
      searchDocuments(query, searchOptions),
      countSearchResults(query, searchOptions),
    ]);
    return {
      results,
      approxTotal: isApproximate ? `${count}+` : `${count}`,
    };
  }

  const { value: responseBody, source } =
    await getWithStaleWhileRevalidate<SearchResponseBody>(
      cacheKey,
      async () => {
        const first = await runSearch();
        let finalResults = first.results;
        let finalApproxTotal = first.approxTotal;
        let resultSource: "index" | "live_fetch" = "index";

        if (first.results.length < THIN_RESULTS_THRESHOLD && liveUrlParam) {
          const liveResult = await liveFetchUrl(liveUrlParam);
          if (RETRIABLE_LIVE_FETCH_STATUSES.has(liveResult.status)) {
            const retried = await runSearch();
            finalResults = retried.results;
            finalApproxTotal = retried.approxTotal;
            resultSource = "live_fetch";
          }
        }

        return {
          query,
          lens: resolvedLens.lensName,
          lens_mode: resolvedLens.lensMode,
          raw_results: finalResults,
          synthesized_answer: null,
          pagination: {
            page,
            per_page: perPage,
            approx_total: finalApproxTotal,
          },
          source: resultSource,
        };
      },
      (value) =>
        value.raw_results.length === 0
          ? NEGATIVE_TTL_SECONDS
          : FRESH_TTL_SECONDS + 300,
    );

  res.status(200).json({
    ...responseBody,
    source: source === "miss" ? responseBody.source : "cache",
  });
}
