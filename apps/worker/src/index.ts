import { Queue, Worker, type JobsOptions } from "bullmq";

const connection = {
  ...parseRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6379"),
  maxRetriesPerRequest: null,
};

export const foundationQueueName = "syncos.foundation";

export function createFoundationQueue() {
  return new Queue(foundationQueueName, {
    connection,
    defaultJobOptions: defaultRetryPolicy(),
  });
}

export function createFoundationWorker() {
  return new Worker(
    foundationQueueName,
    async (job) => {
      if (job.name === "demo.health") {
        return { ok: true, received: job.data };
      }
      throw new Error(`Unsupported foundation job: ${job.name}`);
    },
    { connection },
  );
}

export async function enqueueDemoJob() {
  const queue = createFoundationQueue();
  return queue.add("demo.health", { source: "foundation-smoke" });
}

function defaultRetryPolicy(): JobsOptions {
  return {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: false,
  };
}

function parseRedisUrl(value: string) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
  };
}

if (require.main === module) {
  const worker = createFoundationWorker();
  worker.on("completed", (job) => console.log(`completed ${job.id}`));
  worker.on("failed", (job, error) => console.error(`failed ${job?.id}: ${error.message}`));
  console.log(`SyncOS worker listening on ${foundationQueueName}`);
}
