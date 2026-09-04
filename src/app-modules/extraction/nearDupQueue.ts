import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import prisma from "../../db/prisma";
import { processNearDupJob, NearDupJobData } from "./nearDupProcessor";

const connection = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

export const nearDupQueue = new Queue<NearDupJobData>("nearDupQueue", {
  connection,
});

export const nearDupWorker = new Worker<NearDupJobData>(
  "nearDupQueue",
  (job) => processNearDupJob(job, prisma),
  { connection, concurrency: 1 },
);

export async function enqueueNearDupCheck(documentId: string, simhash: string) {
  await nearDupQueue.add(
    "checkNearDup",
    { documentId, simhash },
    { priority: 10 },
  );
}
