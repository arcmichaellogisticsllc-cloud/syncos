import { Queue, Worker, type JobsOptions } from "bullmq";
import { Pool } from "pg";
import { runMobilizationExpirationScan } from "@syncos/shared";

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

export function startMobilizationExpirationScheduler(options: { pool?: Pool; intervalMs?: number; batchSize?: number; disabled?: boolean } = {}) {
  const disabled = options.disabled ?? process.env.SYNCOS_P6_EXPIRATION_SCAN_DISABLED === "true";
  const databaseUrl = process.env.DATABASE_URL;
  if (disabled || !databaseUrl) return { started: false, stop: async () => undefined };

  const pool = options.pool ?? new Pool({ connectionString: databaseUrl });
  const intervalMs = Math.max(60_000, Number(options.intervalMs ?? process.env.SYNCOS_P6_EXPIRATION_SCAN_INTERVAL_MS ?? 300_000));
  const batchSize = Math.max(1, Math.min(Number(options.batchSize ?? process.env.SYNCOS_P6_EXPIRATION_BATCH_SIZE ?? 50), 250));
  let running = false;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const client = await pool.connect();
    try {
      const result = await runMobilizationExpirationScan(client, { batchSize });
      console.log(`mobilization expiration scan completed emitted=${result.emittedEvents}`);
    } catch (error) {
      console.error(`mobilization expiration scan failed: ${(error as Error).message}`);
    } finally {
      client.release();
      running = false;
    }
  };

  const timer = setInterval(runOnce, intervalMs);
  timer.unref();
  void runOnce();
  return {
    started: true,
    stop: async () => {
      clearInterval(timer);
      if (!options.pool) await pool.end();
    },
  };
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
  const scheduler = startMobilizationExpirationScheduler();
  worker.on("completed", (job) => console.log(`completed ${job.id}`));
  worker.on("failed", (job, error) => console.error(`failed ${job?.id}: ${error.message}`));
  const shutdown = async () => {
    await scheduler.stop();
    await worker.close();
  };
  process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
  console.log(`SyncOS worker listening on ${foundationQueueName}`);
}
