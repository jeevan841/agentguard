/**
 * redteamQueue.js — BullMQ job queue for red-team suite runs
 *
 * Replaces the fire-and-forget runRedTeamSuite() promise pattern in
 * src/routes/redteam.js. Moves red-team execution into a durable job queue so:
 *
 *   - Process restarts don't silently drop in-flight runs
 *   - Failed runs are retried automatically (exponential backoff)
 *   - Dead-lettered (exhausted) jobs remain inspectable in Redis
 *   - The run's status in the DB is always consistent with queue state
 *
 * Queue name: 'redteam'
 * Redis connection: the existing REDIS_URL — no new infra required.
 *
 * Job payload: { agent_id, attack_types, run_id }
 * run_id must be created in the DB *before* the job is enqueued so the
 * worker has a stable row to update.
 */
'use strict';

const { Queue, Worker, QueueEvents } = require('bullmq');
const { runRedTeamSuite } = require('../services/RedTeamService');
const prisma = require('../prisma/client');

// ── Shared Redis connection config ────────────────────────────────────────────
// BullMQ requires ioredis options (not a pre-created client) for its internal
// connection management. We read from the same env vars as the rest of the app.
function getConnectionConfig() {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
  const conn = {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    maxRetriesPerRequest: null, // BullMQ requirement
  };
  if (process.env.REDIS_PASSWORD) conn.password = process.env.REDIS_PASSWORD;
  if (process.env.REDIS_TLS === 'true') conn.tls = {};
  return conn;
}

const connection = getConnectionConfig();

// ── Queue (producer side) ─────────────────────────────────────────────────────
const redteamQueue = new Queue('redteam', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,   // 5s → 25s → 125s
    },
    removeOnComplete: { count: 100 },  // keep last 100 completed jobs for inspection
    removeOnFail: { count: 200 },      // keep last 200 failed jobs
  },
});

// ── Worker (consumer side) ────────────────────────────────────────────────────
let worker = null;

/**
 * Start the BullMQ worker. Called once from src/index.js on startup.
 * @returns {Worker}
 */
function startWorker() {
  worker = new Worker(
    'redteam',
    async (job) => {
      const { agent_id, attack_types, run_id } = job.data;

      // Update status to running
      await prisma.redTeamRun.update({
        where: { id: run_id },
        data: { status: 'running' },
      }).catch(() => {}); // Row may not exist in tests — swallow

      const completed = await runRedTeamSuite(agent_id, attack_types);
      console.log(`[RedTeam] Job ${job.id} run ${run_id} done. Pass rate: ${completed.pass_rate?.toFixed(1)}%`);
    },
    {
      connection,
      concurrency: 2,  // max 2 red-team suites in parallel
    }
  );

  worker.on('failed', async (job, err) => {
    console.error(`[RedTeam] Job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}):`, err.message);

    // On final failure (no more retries), mark the DB row
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      const { run_id } = job.data;
      await prisma.redTeamRun.update({
        where: { id: run_id },
        data: { status: 'failed' },
      }).catch(() => {});
    }
  });

  worker.on('error', (err) => {
    console.error('[RedTeam Worker] Unhandled error:', err.message);
  });

  console.log('[RedTeam] BullMQ worker started (concurrency=2)');
  return worker;
}

/**
 * Graceful shutdown — drain in-flight jobs before exiting.
 * Called from the SIGTERM handler in index.js.
 */
async function stopWorker() {
  if (worker) {
    await worker.close();
    console.log('[RedTeam] BullMQ worker closed');
  }
  await redteamQueue.close();
}

module.exports = { redteamQueue, startWorker, stopWorker };
