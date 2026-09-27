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
  let titleMatchUrl: string;
  let bodyOnlyMatchUrl: string;

  beforeAll(async () => {
    const [titleMatch, bodyOnlyMatch, nearDupOriginal] = await Promise.all([
      seedDocument({
        title: "Postgres Indexing Guide",
        description: "A general overview of databases",
        cleanText: "This article covers various database topics broadly.",
      }),
      seedDocument({
        title: "General Database Concepts",
        description: "An overview of storage systems",
        cleanText:
          "Somewhere deep in this article we briefly mention indexing as one of many topics.",
      }),
      seedDocument({
        title: "Indexing Basics",
        description: "Indexing overview",
        cleanText: "Indexing content here.",
      }),
    ]);

    titleMatchUrl = titleMatch.canonicalUrl;
    bodyOnlyMatchUrl = bodyOnlyMatch.canonicalUrl;

    await seedDocument({
      title: "Indexing Basics Copy",
      description: "Indexing overview copy",
      cleanText: "Indexing content here, duplicated.",
      nearDuplicateOfId: nearDupOriginal.id,
    });
  }, 30000);

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { id: { in: createdIds } } });
  });

  it("ranks a title match higher than a body-only match for the same term", async () => {
    const results = await searchDocuments("indexing", {
      domains: [TEST_DOMAIN],
    });
    const titleMatchRank = results.find((r) => r.url === titleMatchUrl);
    const bodyOnlyMatchRank = results.find((r) => r.url === bodyOnlyMatchUrl);

    expect(titleMatchRank).toBeDefined();
    expect(bodyOnlyMatchRank).toBeDefined();
    expect(titleMatchRank!.rank_score).toBeGreaterThan(
      bodyOnlyMatchRank!.rank_score,
    );
  });

  it("returns results ordered by rank descending", async () => {
    const results = await searchDocuments("indexing", {
      domains: [TEST_DOMAIN],
    });
    const ranks = results.map((r) => r.rank_score);
    const sorted = [...ranks].sort((a, b) => b - a);
    expect(ranks).toEqual(sorted);
  });

  it("excludes documents marked as near-duplicates from results", async () => {
    const results = await searchDocuments("indexing & basics & copy", {
      domains: [TEST_DOMAIN],
    });
    const found = results.some((r) => r.title === "Indexing Basics Copy");
    expect(found).toBe(false);
  });

  it("returns an empty array for a query matching nothing", async () => {
    const results = await searchDocuments("zzznonexistentqueryterm", {
      domains: [TEST_DOMAIN],
    });
    expect(results).toEqual([]);
  });

  it("filters results to only the given domains", async () => {
    const results = await searchDocuments("indexing", {
      domains: ["some-other-domain.example"],
    });
    expect(results).toEqual([]);
  });

  it("includes a non-empty snippet in each result", async () => {
    const results = await searchDocuments("indexing", {
      domains: [TEST_DOMAIN],
    });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => expect(r.snippet.length).toBeGreaterThan(0));
  });

    it("filters results by publishedAt date range", async () => {
      const inRange = await prisma.document.create({
        data: {
          canonicalUrl: `https://${TEST_DOMAIN}/${randomUUID()}`,
          domain: TEST_DOMAIN,
          title: "Dated Indexing Article",
          cleanText: "Indexing content with a known date.",
          contentHash: randomUUID(),
          publishedAt: new Date("2025-06-15"),
          lensTags: [],
        },
      });
      await prisma.$executeRaw`
      UPDATE documents SET search_vector = setweight(to_tsvector('english', ${inRange.title}), 'A')
      WHERE id = ${inRange.id}
    `;
      createdIds.push(inRange.id);

      const results = await searchDocuments("indexing", {
        domains: [TEST_DOMAIN],
        dateFrom: new Date("2025-01-01"),
        dateTo: new Date("2025-12-31"),
      });

      expect(results.some((r) => r.title === "Dated Indexing Article")).toBe(
        true,
      );

      const outOfRange = await searchDocuments("indexing", {
        domains: [TEST_DOMAIN],
        dateFrom: new Date("2026-01-01"),
      });

      expect(outOfRange.some((r) => r.title === "Dated Indexing Article")).toBe(
        false,
      );
    });
});
