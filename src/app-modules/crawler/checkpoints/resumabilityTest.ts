import { crawlQueue } from "../queue";

async function seedDummyJobs() {
  for (let i = 0; i < 5; i++) {
    await crawlQueue.add(
      "crawlJob",
      {
        url: `https://example.com/dummy-${i}`,
        domain: "example.com",
        depth: 0,
        lensId: "test-lens",
        maxDepth: 1,
      },
      { delay: 60000 },
    );
  }

  const count = await crawlQueue.getWaitingCount();
  console.log(`Jobs queued: ${count}`);
}

async function checkJobs() {
  const count = await crawlQueue.getWaitingCount();
  console.log(`Jobs remaining after restart: ${count}`);
  process.exit(0);
}

const mode = process.argv[2];

if (mode === "seed") {
  seedDummyJobs().then(() => process.exit(0));
} else if (mode === "check") {
  checkJobs();
} else {
  console.log("Usage: tsx resumabilityTest.ts seed|check");
  process.exit(1);
}
