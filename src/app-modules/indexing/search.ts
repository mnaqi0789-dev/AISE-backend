import prisma from "../../db/prisma";

export interface SearchResult {
  id: string;
  title: string | null;
  rank: number;
}

export async function searchDocuments(
  query: string,
  limit = 20,
): Promise<SearchResult[]> {
  const results = await prisma.$queryRaw<SearchResult[]>`
    SELECT id, title, ts_rank_cd(search_vector, to_tsquery('english', ${query})) AS rank
    FROM documents
    WHERE search_vector @@ to_tsquery('english', ${query})
      AND "nearDuplicateOfId" IS NULL
    ORDER BY rank DESC
    LIMIT ${limit}
  `;

  return results;
}
