import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import prisma from "../../../db/prisma";
import { countSearchResults } from "../search";

const TEST_DOMAIN = `test-count-${randomUUID()}.example`;
const createdIds: string[] = [];

describe("countSearchResults (integration, requires real Neon connection)", () => {
  beforeAll(async () => {
    const docs = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prisma.document.create({
          data: {
            canonicalUrl: `https://${TEST_DOMAIN}/${randomUUID()}`,
            domain: TEST_DOMAIN,
            title: `Countable Article ${i}`,
            cleanText: "Some countable content here.",
            contentHash: randomUUID(),
            lensTags: [],
          },
        }),
      ),
    );

    await Promise.all(
      docs.map(
        (d) =>
          prisma.$executeRaw`
          UPDATE documents SET search_vector = setweight(to_tsvector('english', ${d.title}), 'A')
          WHERE id = ${d.id}
        `,
      ),
    );

    createdIds.push(...docs.map((d) => d.id));
  }, 30000);

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { id: { in: createdIds } } });
  });

  it("returns an exact, non-approximate count under the cap", async () => {
    const result = await countSearchResults("countable", {
      domains: [TEST_DOMAIN],
    });
    expect(result.count).toBe(5);
    expect(result.isApproximate).toBe(false);
  });

  it("returns zero for a query matching nothing in scope", async () => {
    const result = await countSearchResults("zzznonexistentterm", {
      domains: [TEST_DOMAIN],
    });
    expect(result.count).toBe(0);
    expect(result.isApproximate).toBe(false);
  });
});
