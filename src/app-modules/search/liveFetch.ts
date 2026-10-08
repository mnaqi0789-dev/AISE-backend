import prisma from "../../db/prisma";
import { fetchUrl } from "../crawler/fetcher";
import { extractContent } from "../extraction/contentExtractor";
import { extractMetadata } from "../extraction/metadataExtractor";
import { computeContentHash, computeSimhash } from "../extraction/hashing";
import { enqueueNearDupCheck } from "../extraction/nearDupQueue";
import {
  claimLiveFetch,
  releaseLiveFetch,
  waitForLiveFetch,
} from "./liveFetchLock";

export type LiveFetchStatus =
  | "already_indexed"
  | "fetched"
  | "waited"
  | "timed_out"
  | "failed";

export interface LiveFetchResult {
  status: LiveFetchStatus;
  documentId: string | null;
}

export async function liveFetchUrl(url: string): Promise<LiveFetchResult> {
  const existing = await prisma.document.findUnique({
    where: { canonicalUrl: url },
  });
  if (existing) {
    return { status: "already_indexed", documentId: existing.id };
  }

  const acquired = await claimLiveFetch(url);
  if (!acquired) {
    const cleared = await waitForLiveFetch(url);
    if (!cleared) {
      return { status: "timed_out", documentId: null };
    }

    const nowExisting = await prisma.document.findUnique({
      where: { canonicalUrl: url },
    });
    return nowExisting
      ? { status: "waited", documentId: nowExisting.id }
      : { status: "failed", documentId: null };
  }

  try {
    const result = await fetchUrl(url);
    if (result.statusCode < 200 || result.statusCode >= 300) {
      return { status: "failed", documentId: null };
    }

    const content = extractContent(result.rawHtml, url);
    if (content.lowContent) {
      return { status: "failed", documentId: null };
    }

    const metadata = extractMetadata(result.rawHtml, url);
    const contentHash = computeContentHash(content.cleanText);
    const simhash = computeSimhash(content.cleanText);

    try {
      const document = await prisma.document.create({
        data: {
          canonicalUrl: metadata.canonicalUrl,
          domain: metadata.domain,
          title: metadata.title,
          description: metadata.description,
          publishedAt: metadata.publishedAt,
          cleanText: content.cleanText,
          contentHash,
          simhash,
          lensTags: [],
        },
      });

      await prisma.$executeRaw`
        UPDATE documents SET search_vector =
          setweight(to_tsvector('english', coalesce(${metadata.title}, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(${metadata.description}, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(${content.cleanText}, '')), 'C')
        WHERE id = ${document.id}
      `;

      await enqueueNearDupCheck(document.id, simhash);

      return { status: "fetched", documentId: document.id };
    } catch (err: any) {
      if (err.code === "P2002") {
        const dup = await prisma.document.findFirst({
          where: {
            OR: [{ canonicalUrl: metadata.canonicalUrl }, { contentHash }],
          },
        });
        return dup
          ? { status: "already_indexed", documentId: dup.id }
          : { status: "failed", documentId: null };
      }
      throw err;
    }
  } catch {
    return { status: "failed", documentId: null };
  } finally {
    await releaseLiveFetch(url);
  }
}
