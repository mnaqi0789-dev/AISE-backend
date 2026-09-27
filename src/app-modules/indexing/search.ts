import prisma from "../../db/prisma";

export interface SearchResult {
  title: string | null;
  url: string;
  domain: string;
  snippet: string;
  rank_score: number;
}

export async function searchDocuments(
  query: string,
  options: { domains?: string[]; limit?: number; offset?: number } = {},
): Promise<SearchResult[]> {
  const { domains, limit = 20, offset = 0 } = options;

  const domainFilter = domains && domains.length > 0 ? domains : null;

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
    ORDER BY rank_score DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return results;
}
