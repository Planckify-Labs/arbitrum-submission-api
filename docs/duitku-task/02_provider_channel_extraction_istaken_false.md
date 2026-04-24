# Task 02 — Extract `ProviderChannel` table + backfill Xendit rows

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §6.1 (`Channel` + `ProviderChannel` end-state), §6.3 step 3 (`CREATE TABLE "ProviderChannel" …`)

## Why this matters

Today `Channel` mixes canonical metadata (label, icon, account format,
priority) with Xendit-specific fields (`xenditMinAmountIdr`,
`xenditMaxAmountIdr`, `xenditFeeIdr`). Adding Duitku without
extraction means adding `duitku*` columns for every channel, then
`provider3*`, `provider4*`, forever. Extracting a per-provider table
means provider #N lands as **rows, not columns** — `Channel` becomes
the stable merchant-facing catalog.

**Depends on:** task 01 (schema rename must land first so the
migration pipeline is in the expected state).

## Scope

Edit `prisma/schema.prisma`:

- Add `model ProviderChannel` per research §6.1:
  - `id` (ulid), `channelCode`, `country` (char(2)), `provider`,
    `providerChannelCode`, `minAmountIdr`, `maxAmountIdr`, `feeIdr`,
    `isActive`, `createdAt`, `updatedAt`.
  - Composite FK → `Channel(channelCode, country)`.
  - `@@unique([channelCode, country, provider])`.
  - `@@index([provider, isActive])`.
- Add relation on `Channel`: `providerChannels ProviderChannel[]`.
- Remove from `Channel`: `xenditMinAmountIdr`, `xenditMaxAmountIdr`,
  `xenditFeeIdr`.

Create the migration (can be the same migration file as task 01 if the
two land together):

1. `CREATE TABLE "ProviderChannel"` with columns + FK + unique + index.
2. **Backfill in the same migration:** `INSERT INTO "ProviderChannel"
   SELECT … FROM "Channel"` mirroring every existing channel as a
   `provider = 'xendit'` row, with `providerChannelCode = channelCode`
   (Xendit codes match canonical today) and
   `feeIdr / minAmountIdr / maxAmountIdr` copied from the old `Channel`
   columns.
3. `ALTER TABLE "Channel" DROP COLUMN` for each of the three Xendit
   columns — only **after** the backfill succeeds.

## Rules (non-negotiable)

- **Backfill before drop.** Never `DROP COLUMN` before the `INSERT
  SELECT` has copied the data; you lose fee schedules the instant the
  migration runs.
- **FK to `Channel` uses the composite key** `(channelCode, country)`.
  Both columns present in `ProviderChannel` — see research §6.1.
- **Do not add a Duitku backfill here.** Duitku rows land via the seed
  script (task 11) or an admin tool. This task only creates the table
  and migrates existing Xendit data.
- **`providerChannelCode` for Xendit rows = canonical code** (they
  match today; `BCA` → `BCA`). This is a no-op translation on the wire
  — the Xendit adapter keeps sending the same body.
- Run `bash scripts/lint-migrations.sh` — `ProviderChannel` has an FK
  to `Channel`, not a hypertable, so clear.

## Acceptance

- [ ] `prisma/schema.prisma` defines `ProviderChannel` with the schema
      from research §6.1.
- [ ] `Channel` no longer has `xenditMinAmountIdr` /
      `xenditMaxAmountIdr` / `xenditFeeIdr`.
- [ ] Migration SQL creates `ProviderChannel`, backfills one row per
      pre-existing `Channel` row with `provider = 'xendit'`, and only
      then drops the three Xendit columns on `Channel`.
- [ ] Applied migration on a dev DB with seeded channels: count of
      `ProviderChannel` rows where `provider = 'xendit'` equals count
      of `Channel` rows.
- [ ] `ProviderChannel` fees for the Xendit rows equal the old
      `Channel.xenditFeeIdr` values.
- [ ] `bash scripts/lint-migrations.sh` passes.
- [ ] `pnpm prisma generate` clean.

## Out of scope

- Duitku `ProviderChannel` rows (task 11 seeds these).
- Callsite rewrites that change `channel.xenditFeeIdr` reads to
  `providerChannel.feeIdr` lookups — that's part of task 03.
- DTO response shape for channel catalog endpoints — task 04 handles
  backward compat.
