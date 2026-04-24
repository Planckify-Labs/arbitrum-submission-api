/**
 * CLI: read the current Duitku master merchant balance (task 18).
 *
 * Usage: `pnpm tsx src/scripts/payout/duitku-balance.ts`
 *
 * Boots a minimal Nest context, calls `DuitkuPayoutProvider.checkBalance`,
 * logs the result, and exits. Intended for cron-style observability:
 *
 *     # Every 30 minutes, alert on balance < 10M IDR
 *     cron: 30-min interval → `pnpm tsx src/scripts/payout/duitku-balance.ts | jq ...`
 *
 * Never log the secret — the adapter's logger redacts it at source. Do
 * not expose the output to public dashboards; master balance is ours,
 * not the merchant's.
 */

import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { DuitkuPayoutProvider } from "../../payout/providers/duitku-payout.provider";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });
  try {
    const duitku = app.get(DuitkuPayoutProvider);
    const { balance, currency } = await duitku.checkBalance();
    // Emit a single line of structured JSON so alerting pipelines can
    // `jq` into it. `date` is the ingest timestamp; balance is major-unit
    // IDR (no decimals).
    const payload = {
      timestamp: new Date().toISOString(),
      provider: "duitku",
      balance,
      currency,
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `Duitku balance check failed: ${msg}\n`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
