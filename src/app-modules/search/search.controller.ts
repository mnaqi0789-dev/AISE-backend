import { Request, Response } from "express";
import { searchDocuments, countSearchResults } from "../indexing/search";
import { resolveLens } from "./lensResolver";
import {
  buildCacheKey,
  getWithStaleWhileRevalidate,
  NEGATIVE_TTL_SECONDS,
  FRESH_TTL_SECONDS,
} from "./cache";

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
  source: "index" | "cache";
}

export async function search(req: Request, res: Response) {
  const query = (req.query.q as string)?.trim();
  const lensParam = req.query.lens as string | undefined;
  const domainParam = req.query.domain as string | undefined;
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

  const { value: responseBody, source } =
    await getWithStaleWhileRevalidate<SearchResponseBody>(
      cacheKey,
      async () => {
        const [results, { count, isApproximate }] = await Promise.all([
          searchDocuments(query, searchOptions),
          countSearchResults(query, searchOptions),
        ]);

        return {
          query,
          lens: resolvedLens.lensName,
          lens_mode: resolvedLens.lensMode,
          raw_results: results,
          synthesized_answer: null,
          pagination: {
            page,
            per_page: perPage,
            approx_total: isApproximate ? `${count}+` : `${count}`,
          },
          source: "index",
        };
      },
      (value) =>
        value.raw_results.length === 0
          ? NEGATIVE_TTL_SECONDS
          : FRESH_TTL_SECONDS + 300,
    );

  res
    .status(200)
    .json({ ...responseBody, source: source === "miss" ? "index" : "cache" });
}
