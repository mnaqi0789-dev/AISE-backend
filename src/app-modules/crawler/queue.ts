import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { processCrawlJob, CrawlJobData } from "./processor";

const connection = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

export const crawlQueue = new Queue<CrawlJobData>("crawlQueue", { connection });

export const crawlWorker = new Worker<CrawlJobData>(
  "crawlQueue",
  (job) => processCrawlJob(job, connection, crawlQueue),
  { connection },
);
