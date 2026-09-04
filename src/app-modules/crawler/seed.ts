import { crawlQueue } from "./queue";
import prisma from "../../db/prisma";

export async function startCrawlForLens(lensId: string, maxDepth: number) {
  const lens = await prisma.lens.findUnique({ where: { id: lensId } });

  if (!lens) {
    throw new Error(`Lens ${lensId} not found`);
  }

  for (const seedUrl of lens.domains) {
    const url = seedUrl.startsWith("http") ? seedUrl : `https://${seedUrl}`;
    const domain = new URL(url).hostname;

    await crawlQueue.add(
      "crawlJob",
      { url, domain, depth: 0, lensId, maxDepth },
      { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
    );
  }
}

export function isInScope(url: string, allowedDomains: string[]): boolean {
  const hostname = new URL(url).hostname;
  return allowedDomains.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
  );
}
