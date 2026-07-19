/**
 * One-off backfill: re-write every `User.walletAddress` into its canonical
 * per-chain form (see `canonicalizeWalletAddress`) so that, after the
 * `walletAddressLower` column is dropped, `walletAddress @unique` is a correct
 * case-insensitive dedup key.
 *
 *   Dry run (default — writes nothing, just reports):
 *     pnpm backfill:canonical-address
 *   Apply:
 *     pnpm backfill:canonical-address --apply
 *
 * Run this against a database BEFORE deploying the code that looks up users by
 * canonical `walletAddress`, otherwise a purchase-created lowercase row would
 * miss a checksummed lookup and mint a duplicate user. Idempotent and safe to
 * re-run.
 */
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { canonicalizeWalletAddress } from "../utils/address";

// Match prisma.config.ts: load .env when present (absent in Docker prod,
// where the env is injected). Uses Node's built-in loader — no dotenv dep.
const envPath = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const apply = process.argv.includes("--apply");
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { walletAddress: { not: null } },
    select: { id: true, walletAddress: true },
  });

  const changes: { id: string; from: string; to: string }[] = [];
  // canonical value -> user ids that would end up holding it. >1 => collision.
  const byCanonical = new Map<string, string[]>();

  for (const u of users) {
    const from = u.walletAddress as string;
    const to = canonicalizeWalletAddress(from);
    byCanonical.set(to, [...(byCanonical.get(to) ?? []), u.id]);
    if (to !== from) changes.push({ id: u.id, from, to });
  }

  const collisions = [...byCanonical.entries()].filter(
    ([, ids]) => ids.length > 1,
  );

  console.log(`Scanned ${users.length} users with a wallet address.`);
  console.log(`${changes.length} row(s) would change to canonical form.`);

  if (collisions.length > 0) {
    console.error(
      `ABORTING: ${collisions.length} canonical value(s) map to multiple users ` +
        `(would violate walletAddress @unique). Resolve these duplicates first:`,
    );
    for (const [canonical, ids] of collisions) {
      console.error(`  ${canonical} <- users ${ids.join(", ")}`);
    }
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    for (const c of changes.slice(0, 50)) {
      console.log(`  ${c.from}  ->  ${c.to}`);
    }
    if (changes.length > 50) console.log(`  ...and ${changes.length - 50} more`);
    console.log("\nDry run — pass --apply to write these changes.");
    return;
  }

  // No collisions => every target value is distinct across rows, so updates
  // are safe in any order (no intermediate unique-constraint clash).
  await prisma.$transaction(
    changes.map((c) =>
      prisma.user.update({
        where: { id: c.id },
        data: { walletAddress: c.to },
      }),
    ),
  );
  console.log(`Applied ${changes.length} update(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
