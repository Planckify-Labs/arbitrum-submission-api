#!/usr/bin/env node
/**
 * Fire the recurring-invest watcher on demand (QA only).
 *
 * The watcher runs on a daily `@Cron`, and a freshly created plan sets its
 * first `nextDueAt` a full cycle out — correct in production, useless when
 * you want to see the nudge now. This enqueues the same `scan` job the cron
 * enqueues, so the code path under test is the real one, not a shortcut.
 *
 * The API server must be running: it hosts the worker that drains the queue.
 * This script only puts the job on it.
 *
 * Usage (from api/):
 *   node scripts/trigger-recurring-invest-watcher.mjs
 *
 * Pair it with a due plan:
 *   psql "$DATABASE_URL" -c 'UPDATE "RecurringInvestPlan"
 *     SET "nextDueAt" = now() - interval ''1 minute'' WHERE status = ''active'';'
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Queue } from "bullmq";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal .env reader — this script deliberately pulls in no Nest runtime. */
function env(key, fallback) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(join(ROOT, ".env"), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${key}=`));
    if (!line) return fallback;
    return line.slice(key.length + 1).replace(/^["']|["']$/g, "");
  } catch {
    return fallback;
  }
}

const password = env("VALKEY_PASSWORD");
const queue = new Queue("recurring-invest-watcher", {
  connection: {
    host: env("VALKEY_HOST", "localhost"),
    port: Number(env("VALKEY_PORT", "6379")),
    ...(password ? { password } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  },
});

const job = await queue.add(
  "scan",
  { reason: "manual-qa" },
  {
    jobId: `recurring-invest-manual-${Date.now()}`,
    removeOnComplete: true,
    removeOnFail: 100,
  },
);

console.log(`Enqueued recurring-invest-watcher scan (job ${job.id}).`);
console.log("Watch the API logs for [recurring-invest-watcher] scan complete.");
await queue.close();
