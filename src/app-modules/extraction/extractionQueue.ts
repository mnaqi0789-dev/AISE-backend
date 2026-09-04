import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import prisma from "../../db/prisma";
import { processExtractionJob, ExtractionJobData } from "./extractionProcessor";

const connection = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

export const extractionQueue = new Queue<ExtractionJobData>("extractionQueue", {
  connection,
});

export const extractionWorker = new Worker<ExtractionJobData>(
  "extractionQueue",
  (job) => processExtractionJob(job, prisma),
  { connection, concurrency: 5 },
);
