import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import prisma from "../../../db/prisma";
import { searchDocuments } from "../search";

const TEST_DOMAIN = `test-${randomUUID()}.example`;
const createdIds: string[] = [];

async function seedDocument(data: {
  title: string;
  description: string;
  cleanText: string;
  nearDuplicateOfId?: string;
}) {
  const doc = await prisma.document.create({
    data: {
      canonicalUrl: `https://${TEST_DOMAIN}/${randomUUID()}`,
      domain: TEST_DOMAIN,
      title: data.title,
      description: data.description,
      cleanText: data.cleanText,
      contentHash: randomUUID(),
      simhash: null,
      lensTags: [],
      nearDuplicateOfId: data.nearDuplicateOfId,
    },
  });

  await prisma.$executeRaw`
    UPDATE documents SET search_vector =
      setweight(to_tsvector('english', coalesce(${data.title}, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(${data.description}, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(${data.cleanText}, '')), 'C')
    WHERE id = ${doc.id}
  `;

  createdIds.push(doc.id);
  return doc;
}

describe("searchDocuments (integration, requires real Neon connection)", () => {
  let titleMatchId: string;
  let bodyOnlyMatchId: string;

  beforeAll(async () => {
    const titleMatch = await seedDocument({
      title: "Postgres Indexing Guide",
      description: "A general overview of databases",
      cleanText: "This article covers various database topics broadly.",
    });
    titleMatchId = titleMatch.id;

    const bodyOnlyMatch = await seedDocument({
      title: "General Database Concepts",
      description: "An overview of storage systems",
      cleanText:
        "Somewhere deep in this article we briefly mention indexing as one of many topics.",
    });
    bodyOnlyMatchId = bodyOnlyMatch.id;

    const nearDupOriginal = await seedDocument({
      title: "Indexing Basics",
      description: "Indexing overview",
      cleanText: "Indexing content here.",
    });

    await seedDocument({
      title: "Indexing Basics Copy",
      description: "Indexing overview copy",
      cleanText: "Indexing content here, duplicated.",
      nearDuplicateOfId: nearDupOriginal.id,
    });
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { id: { in: createdIds } } });
  });

  it("ranks a title match higher than a body-only match for the same term", async () => {
    const results = await searchDocuments("indexing");
    const titleMatchRank = results.find((r) => r.id === titleMatchId);
    const bodyOnlyMatchRank = results.find((r) => r.id === bodyOnlyMatchId);

    expect(titleMatchRank).toBeDefined();
    expect(bodyOnlyMatchRank).toBeDefined();
    expect(titleMatchRank!.rank).toBeGreaterThan(bodyOnlyMatchRank!.rank);
  });

  it("returns results ordered by rank descending", async () => {
    const results = await searchDocuments("indexing");
    const ranks = results.map((r) => r.rank);
    const sorted = [...ranks].sort((a, b) => b - a);
    expect(ranks).toEqual(sorted);
  });

  it("excludes documents marked as near-duplicates from results", async () => {
    const results = await searchDocuments("indexing & basics & copy");
    const found = results.some((r) => r.title === "Indexing Basics Copy");
    expect(found).toBe(false);
  });

  it("returns an empty array for a query matching nothing", async () => {
    const results = await searchDocuments("zzznonexistentqueryterm");
    expect(results).toEqual([]);
  });
});
