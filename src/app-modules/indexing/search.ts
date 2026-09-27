import prisma from "../../db/prisma";

export interface SearchResult {
  title: string | null;
  url: string;
  domain: string;
  snippet: string;
  rank_score: number;
}

export interface SearchOptions {
  domains?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

const COUNT_CAP = 1000;

export async function searchDocuments(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const { domains, dateFrom, dateTo, limit = 20, offset = 0 } = options;

  const domainFilter = domains && domains.length > 0 ? domains : null;
  const fromFilter = dateFrom ?? null;
  const toFilter = dateTo ?? null;

  const results = await prisma.$queryRaw<SearchResult[]>`
    SELECT
      title,
      "canonicalUrl" AS url,
      domain,
      ts_headline('english', "cleanText", to_tsquery('english', ${query}), 'MaxFragments=1, MaxWords=30') AS snippet,
      ts_rank_cd(search_vector, to_tsquery('english', ${query})) AS rank_score
    FROM documents
    WHERE search_vector @@ to_tsquery('english', ${query})
      AND "nearDuplicateOfId" IS NULL
      AND (${domainFilter}::text[] IS NULL OR domain = ANY(${domainFilter}::text[]))
      AND (${fromFilter}::timestamp IS NULL OR "publishedAt" >= ${fromFilter}::timestamp)
      AND (${toFilter}::timestamp IS NULL OR "publishedAt" <= ${toFilter}::timestamp)
    ORDER BY rank_score DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return results;
}

export async function countSearchResults(
  query: string,
  options: SearchOptions = {},
): Promise<{ count: number; isApproximate: boolean }> {
  const { domains, dateFrom, dateTo } = options;

  const domainFilter = domains && domains.length > 0 ? domains : null;
  const fromFilter = dateFrom ?? null;
  const toFilter = dateTo ?? null;

  const result = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM (
      SELECT 1 FROM documents
      WHERE search_vector @@ to_tsquery('english', ${query})
        AND "nearDuplicateOfId" IS NULL
        AND (${domainFilter}::text[] IS NULL OR domain = ANY(${domainFilter}::text[]))
        AND (${fromFilter}::timestamp IS NULL OR "publishedAt" >= ${fromFilter}::timestamp)
        AND (${toFilter}::timestamp IS NULL OR "publishedAt" <= ${toFilter}::timestamp)
      LIMIT ${COUNT_CAP}
    ) capped
  `;

  const count = Number(result[0].count);
  return { count, isApproximate: count === COUNT_CAP };
}
