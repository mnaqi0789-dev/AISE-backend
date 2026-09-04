import { Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { hammingDistance } from "./hashing";

export interface NearDupJobData {
  documentId: string;
  simhash: string;
}

const HAMMING_THRESHOLD = 3;

export async function processNearDupJob(
  job: Job<NearDupJobData>,
  prisma: PrismaClient,
) {
  const { documentId, simhash } = job.data;

  const candidates = await prisma.document.findMany({
    where: {
      id: { not: documentId },
      simhash: { not: null },
      nearDuplicateOfId: null,
    },
    select: { id: true, simhash: true, crawledAt: true },
  });

  for (const candidate of candidates) {
    if (!candidate.simhash) continue;

    const distance = hammingDistance(simhash, candidate.simhash);
    if (distance <= HAMMING_THRESHOLD) {
      await prisma.document.update({
        where: { id: documentId },
        data: { nearDuplicateOfId: candidate.id },
      });
      return;
    }
  }
}
