# Task 15 — Snapshot test: rename migration preserves rows + backfills `provider`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §6.3, §7 bullet 9

## Why this matters

Tasks 01–02 change the physical schema under live data. A destructive
migration run against prod would irreversibly delete every existing
`XenditPayout` row and every `Channel.xenditFeeIdr` setting. This
test runs the rename migration against a pre-migration snapshot and
asserts every row survives and every new column is correctly
backfilled. It's the insurance policy on the whole refactor.

**Depends on:** tasks 01, 02.

## Scope

Create `test/migration/provider-agnostic-payout.spec.ts` (or wherever
the repo's migration-against-snapshot tests already live — check
`test/e2e/` first).

Test harness (gated by `RUN_MIGRATION_SNAPSHOT=1` env so CI skips it
unless a scratch DB is provisioned):

1. Spin up a fresh Postgres DB (via `DATABASE_URL_MIGRATION_TEST` or
   a docker-compose container — pick what the repo already has).
2. Apply all migrations **before** the provider-agnostic one.
3. Seed a representative dataset:
   - ≥3 `Channel` rows with distinct
     `xenditMinAmountIdr`/`xenditMaxAmountIdr`/`xenditFeeIdr` values.
   - ≥3 `Merchant` rows with distinct `xenditChannelCode`,
     `xenditAccountNumber` (pretend-encrypted bytes),
     `xenditAccountHolderName`, and `payoutProvider = "xendit"`.
   - ≥5 `XenditPayout` rows across the merchants with mixed statuses
     and populated `xenditPayoutId`, `xenditResponseBody`.
4. Record row counts + a full row dump (keyed by `id`) of each
   affected table.
5. Apply the provider-agnostic migration.
6. Assert:
   - `ProviderPayout` row count equals the pre-migration
     `XenditPayout` count.
   - Every pre-existing `ProviderPayout` row has `provider = "xendit"`
     and `providerResponseCode = null`.
   - `providerPayoutId` value == pre-existing `xenditPayoutId` value
     for every row (same column, renamed).
   - `providerResponseBody` value == pre-existing `xenditResponseBody`
     value.
   - `Merchant.payoutChannelCode` / `payoutAccountNumber` /
     `payoutAccountHolderName` values preserved from their old `xendit*`
     originals for every row.
   - `ProviderChannel` has one `provider = "xendit"` row per
     pre-migration `Channel` row, with `feeIdr` /
     `minAmountIdr` / `maxAmountIdr` copied from the old
     `Channel.xendit*` columns.
   - `Channel` no longer has `xenditMinAmountIdr` /
     `xenditMaxAmountIdr` / `xenditFeeIdr` columns (introspect
     `information_schema.columns`).
7. **Idempotence:** re-applying the migration (if the harness
   supports it) is a no-op or fails explicitly; it does not
   double-backfill.

## Rules (non-negotiable)

- **Isolated DB.** Never run this against dev or shared CI DB. The
  harness must spin up and tear down its own database.
- **Gate with `RUN_MIGRATION_SNAPSHOT=1`** — default CI skips it;
  a dedicated job (or manual run) sets the flag. Avoids every PR
  paying the cost.
- **Dump-and-compare, not row-by-row asserts.** A diff over the full
  rowset is more useful than assertFieldA, assertFieldB, … when a
  regression hits.
- **Do not clean up on failure.** Leave the scratch DB around for
  post-mortem if an assertion fails.

## Acceptance

- [ ] `test/migration/provider-agnostic-payout.spec.ts` exists and is
      gated by `RUN_MIGRATION_SNAPSHOT=1`.
- [ ] Running with the flag set passes against a fresh scratch DB.
- [ ] Removing any one step from the migration SQL (e.g. the
      `UPDATE SET provider = 'xendit'`) causes the test to fail with
      a clear assertion message.
- [ ] The test dumps + diffs tables rather than asserting individual
      columns one-by-one.

## Out of scope

- Wiring this test into the default CI lane (ops decision — trade-off
  between CI time and regression catch).
- Production data integrity checks (separate ops runbook).
