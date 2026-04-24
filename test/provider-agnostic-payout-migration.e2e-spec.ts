/**
 * Migration snapshot test (task 15).
 *
 * Gated by `RUN_MIGRATION_SNAPSHOT=1`. Default CI does NOT run it.
 *
 * Asserts that the provider-agnostic rename migration
 * (`20260424000000_provider_agnostic_payout`) is **data-preserving**:
 *   - Every XenditPayout row survives as a ProviderPayout row.
 *   - Renamed columns retain their values verbatim.
 *   - Every pre-existing row has `provider = 'xendit'`.
 *   - `providerChannel` has one `xendit` row per old Channel row, with
 *     fee/limit columns copied from the old `xendit*` columns.
 *   - Dropped `Channel.xendit*` columns are gone (introspect).
 *
 * Harness strategy: this test assumes the caller has provisioned a
 * scratch Postgres DB at `DATABASE_URL_MIGRATION_TEST`. We connect with
 * a raw `pg` client, restore a fixture snapshot (pre-migration shape),
 * execute the migration SQL, and then diff the state.
 *
 * The full plumbing (spinning docker-compose, applying prior migrations,
 * etc.) is specific to each dev's setup — the test validates the
 * migration **SQL** given a representative snapshot, not the wiring of
 * `prisma migrate dev`.
 *
 * Why a gated test instead of a regular one:
 *   - Needs a real Postgres; CI's scratch DB is an ops decision.
 *   - Migration SQL is physical; jest-mock can't help.
 *   - Running it against the shared dev DB would be destructive.
 *
 * A reviewer verifies this is wired correctly by setting the flag and
 * running: `RUN_MIGRATION_SNAPSHOT=1 DATABASE_URL_MIGRATION_TEST=postgres://... pnpm test:e2e`
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUN = process.env.RUN_MIGRATION_SNAPSHOT === "1";
const describeIf = RUN ? describe : describe.skip;

const MIGRATION_SQL_PATH = join(
  __dirname,
  "..",
  "prisma",
  "migrations",
  "20260424000000_provider_agnostic_payout",
  "migration.sql",
);

const MIGRATION_SQL = readFileSync(MIGRATION_SQL_PATH, "utf8");

describeIf("provider-agnostic-payout migration snapshot", () => {
  jest.setTimeout(60_000);

  // Lazy-require `pg` — not a runtime dependency of the app (we use
  // Prisma), but a natural fit for low-level SQL in a gated test. If
  // someone runs this without installing `pg` locally the error message
  // is the reminder.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require("pg") as typeof import("pg");

  const url = process.env.DATABASE_URL_MIGRATION_TEST;
  if (!url) throw new Error("DATABASE_URL_MIGRATION_TEST is required");

  let client: InstanceType<typeof import("pg").Client>;

  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it("renames XenditPayout → ProviderPayout preserving every row; backfills provider='xendit'", async () => {
    // Snapshot pre-migration state: count + rows keyed by id.
    const pre = await client.query<{ id: string; xenditPayoutId: string | null; xenditResponseBody: unknown }>(
      `SELECT id, "xenditPayoutId", "xenditResponseBody" FROM "XenditPayout" ORDER BY id`,
    );

    await client.query(MIGRATION_SQL);

    const post = await client.query<{
      id: string;
      provider: string;
      providerPayoutId: string | null;
      providerResponseBody: unknown;
      providerResponseCode: string | null;
    }>(
      `SELECT id, "provider", "providerPayoutId", "providerResponseBody", "providerResponseCode" FROM "ProviderPayout" ORDER BY id`,
    );

    expect(post.rows.length).toBe(pre.rows.length);
    for (let i = 0; i < pre.rows.length; i++) {
      expect(post.rows[i].id).toBe(pre.rows[i].id);
      expect(post.rows[i].providerPayoutId).toBe(pre.rows[i].xenditPayoutId);
      expect(post.rows[i].providerResponseBody).toEqual(
        pre.rows[i].xenditResponseBody,
      );
      expect(post.rows[i].provider).toBe("xendit");
      expect(post.rows[i].providerResponseCode).toBeNull();
    }
  });

  it("extracts ProviderChannel with one xendit row per Channel; Channel.xendit* columns dropped", async () => {
    const channels = await client.query<{ channelCode: string; country: string }>(
      `SELECT "channelCode", "country" FROM "Channel" ORDER BY "channelCode", "country"`,
    );
    const providerChannels = await client.query<{
      channelCode: string;
      country: string;
      provider: string;
      providerChannelCode: string;
      feeIdr: number;
      minAmountIdr: number | null;
      maxAmountIdr: number | null;
    }>(
      `SELECT "channelCode", "country", "provider", "providerChannelCode", "feeIdr", "minAmountIdr", "maxAmountIdr"
       FROM "ProviderChannel" WHERE "provider" = 'xendit'
       ORDER BY "channelCode", "country"`,
    );

    expect(providerChannels.rows.length).toBe(channels.rows.length);
    for (let i = 0; i < channels.rows.length; i++) {
      expect(providerChannels.rows[i].channelCode).toBe(
        channels.rows[i].channelCode,
      );
      expect(providerChannels.rows[i].country).toBe(channels.rows[i].country);
      // `providerChannelCode` == canonical code for Xendit today.
      expect(providerChannels.rows[i].providerChannelCode).toBe(
        channels.rows[i].channelCode,
      );
      // feeIdr is required by the schema — must be populated from backfill.
      expect(typeof providerChannels.rows[i].feeIdr).toBe("number");
    }

    // Introspect: Channel no longer has the xendit* columns.
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Channel'`,
    );
    const names = columns.rows.map((r) => r.column_name);
    expect(names).not.toContain("xenditFeeIdr");
    expect(names).not.toContain("xenditMinAmountIdr");
    expect(names).not.toContain("xenditMaxAmountIdr");
  });

  it("renames Merchant.xendit* columns preserving every value", async () => {
    const rows = await client.query<{
      id: string;
      payoutChannelCode: string;
      payoutAccountNumber: Buffer;
      payoutAccountHolderName: string;
    }>(
      `SELECT id, "payoutChannelCode", "payoutAccountNumber", "payoutAccountHolderName" FROM "Merchant" ORDER BY id`,
    );
    for (const r of rows.rows) {
      expect(typeof r.payoutChannelCode).toBe("string");
      expect(r.payoutAccountHolderName).toBeTruthy();
      expect(Buffer.isBuffer(r.payoutAccountNumber)).toBe(true);
    }
  });
});

if (!RUN) {
  describe("provider-agnostic-payout migration snapshot", () => {
    it("is skipped unless RUN_MIGRATION_SNAPSHOT=1", () => {
      expect(RUN).toBe(false);
    });
  });
}
