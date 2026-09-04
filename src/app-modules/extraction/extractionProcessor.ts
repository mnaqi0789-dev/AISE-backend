import { Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { extractContent } from "./contentExtractor";
import { extractMetadata } from "./metadataExtractor";
import { computeContentHash, computeSimhash } from "./hashing";
import { enqueueNearDupCheck } from "./nearDupQueue";

export interface ExtractionJobData {
  rawFetchId: string;
}

export async function processExtractionJob(
  job: Job<ExtractionJobData>,
  prisma: PrismaClient,
) {
  const { rawFetchId } = job.data;

  const rawFetch = await prisma.rawFetch.findUnique({
    where: { id: rawFetchId },
  });
  if (!rawFetch || !rawFetch.rawHtml) {
    return;
  }

  const content = extractContent(rawFetch.rawHtml, rawFetch.url);

  if (content.lowContent) {
    await prisma.rawFetch.update({
      where: { id: rawFetchId },
      data: { extracted: true },
    });
    return;
  }

  const metadata = extractMetadata(rawFetch.rawHtml, rawFetch.url);
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

    await enqueueNearDupCheck(document.id, simhash);
  } catch (err: any) {
    if (err.code !== "P2002") {
      throw err;
    }
  }

  await prisma.rawFetch.update({
    where: { id: rawFetchId },
    data: { extracted: true },
  });
}
