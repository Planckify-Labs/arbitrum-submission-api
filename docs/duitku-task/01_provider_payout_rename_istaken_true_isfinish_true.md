# Task 01 — Rename `XenditPayout` → `ProviderPayout` + `Merchant` columns + enum

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §6.1, §6.3 steps 1–4

## Why this matters

The current schema is Xendit-branded (`XenditPayout`, `xenditChannelCode`,
`XenditPayoutStatus`). Adding a second provider to a Xendit-branded
table makes every future reader ask "why is Duitku data in a Xendit
table?" — the schema has to stop lying before we add the adapter. This
rename is the foundation the rest of the Duitku work sits on; it
blocks every Phase-2 task and the adapter can't land without it.

The migration is data-preserving (`ALTER TABLE RENAME`, not `DROP` +
`CREATE`), so the Xendit flow keeps working bit-for-bit — only
identifiers change.

## Scope

Edit `prisma/schema.prisma`:

- Rename enum `XenditPayoutStatus` → `ProviderPayoutStatus`. Values
  unchanged (`PENDING` / `PROCESSING` / `COMPLETED` / `FAILED`).
- Rename model `XenditPayout` → `ProviderPayout`. Column renames:
  - `xenditPayoutId` → `providerPayoutId`
  - `xenditResponseBody` → `providerResponseBody`
- Add to `ProviderPayout`:
  - `provider String` (NOT NULL; backfilled to `'xendit'`)
  - `providerResponseCode String?` (nullable)
  - `@@index([provider, status])`
- Rename on `Merchant`:
  - `xenditChannelCode` → `payoutChannelCode`
  - `xenditAccountNumber` → `payoutAccountNumber`
  - `xenditAccountHolderName` → `payoutAccountHolderName`
  - Relation `xenditPayouts` → `payouts`
- Keep `Merchant.payoutProvider String @default("xendit")` unchanged
  (already neutral).

Create the migration:

1. `pnpm prisma migrate dev --create-only --name provider_agnostic_payout`
2. Hand-edit the generated SQL to use `ALTER TABLE RENAME` /
   `ALTER TYPE RENAME` / `RENAME COLUMN` per research §6.3 step 3 —
   Prisma's default diff is destructive.
3. Backfill `provider = 'xendit'` on existing rows **inside the same
   migration**, then add `NOT NULL`.
4. `pnpm prisma migrate dev` to apply; `pnpm prisma generate` to
   regenerate the client.

## Rules (non-negotiable)

- **Use `ALTER … RENAME`, never `DROP` + `CREATE`.** The default
  Prisma diff is destructive and will delete every existing row.
- **Backfill `provider` inside the migration**, before adding
  `NOT NULL`. A two-step deploy can't satisfy `NOT NULL` on a column
  that doesn't exist yet in old code.
- **Do not touch `ProviderChannel`** in this task — that's task 02.
  `Channel` still owns `xenditMinAmountIdr` / `xenditMaxAmountIdr` /
  `xenditFeeIdr` until task 02.
- **Do not touch any `src/` files.** Callsite codemod is task 03.
  This task produces a Prisma client that references the new names;
  the rest of the codebase will not compile until task 03 lands, which
  is expected — tasks 01–03 merge together.
- Run `bash scripts/lint-migrations.sh` after editing the SQL.
  `ProviderPayout` is not a hypertable, so FK rules are satisfied, but
  the linter still runs.

## Acceptance

- [ ] `prisma/schema.prisma` reflects §6.1 end-state for `ProviderPayout`,
      `ProviderPayoutStatus`, and `Merchant` column renames.
- [ ] Migration SQL uses `ALTER … RENAME` for every rename; no `DROP`
      of existing tables/columns.
- [ ] Migration backfills `provider = 'xendit'` before `SET NOT NULL`.
- [ ] `@@index([provider, status])` on `ProviderPayout` present in the
      migration output.
- [ ] `bash scripts/lint-migrations.sh` passes.
- [ ] `pnpm prisma generate` regenerates `generated/prisma/` without
      schema errors.
- [ ] Applied migration on a seeded dev DB: pre-existing Xendit rows
      survive with `provider = 'xendit'` populated.

## Out of scope

- `ProviderChannel` extraction and `Channel` column drops (task 02).
- TypeScript accessor codemod across `src/` (task 03).
- DTO backward-compat aliases (task 04).
