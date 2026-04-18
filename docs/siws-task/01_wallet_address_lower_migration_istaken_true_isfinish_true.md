# Task 01 — `User.walletAddressLower` migration + backfill

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §2.3 gap 1–2, §3.1, §5 step 1

## Why this matters

`User.walletAddress` is lowercased on write and lookup today. Solana
base58 pubkeys are **case-sensitive** — lowercasing corrupts them and
destroys the signature-to-identity mapping. We cannot ship SIWS without
decoupling the lookup key from the emitted-by-wallet address. This task
is the schema prerequisite for every backend SIWS change; it blocks
tasks 08 (namespace-aware login) and anything downstream that reads
`User.walletAddress`.

## Scope

- Add `walletAddressLower String? @unique` to `User` in
  `prisma/schema.prisma`. Keep the existing `walletAddress` column and
  its uniqueness — we need both (exact-match for Solana, normalized for
  EVM).
- Generate the Prisma migration. The emitted SQL must be equivalent to:
  ```sql
  ALTER TABLE "User" ADD COLUMN "walletAddressLower" TEXT;
  UPDATE "User" SET "walletAddressLower" = LOWER("walletAddress")
    WHERE "walletAddress" IS NOT NULL;
  CREATE UNIQUE INDEX "User_walletAddressLower_key"
    ON "User"("walletAddressLower");
  ```
- Run `bash scripts/lint-migrations.sh` to confirm no FK-on-hypertable
  violations were introduced.
- Regenerate the Prisma client (`pnpm prisma generate`) and commit the
  generated output per repo convention.

## Rules (non-negotiable)

- **Do not drop `walletAddress`.** Both columns coexist; existing code
  keeps reading `walletAddress` until the namespace-aware login lands
  (task 08).
- **Backfill runs in the migration itself**, not as a separate script.
  A two-step deploy leaves the unique index unable to build on the
  second deploy.
- **Unique index on `walletAddressLower`**, nullable allowed. Postgres
  treats multiple NULLs as distinct — acceptable for users that
  predate wallet linkage.
- No application-code changes in this task. Writes still go through
  the existing `AuthService.login` unchanged; task 08 will flip them.

## Acceptance

- [ ] `prisma/schema.prisma` has `walletAddressLower` with `@unique`.
- [ ] Migration SQL includes the backfill `UPDATE` between `ADD COLUMN`
      and `CREATE UNIQUE INDEX`.
- [ ] `pnpm prisma migrate dev` applies cleanly on a fresh DB and on a
      DB with existing EVM users — both paths leave
      `walletAddressLower = LOWER(walletAddress)` for every row.
- [ ] `bash scripts/lint-migrations.sh` passes.
- [ ] `pnpm prisma generate` regenerates `generated/prisma/` without
      type errors.

## Out of scope

- Writing the new column from application code (task 08).
- Removing `.toLowerCase()` from `AuthService` (task 08).
- Case-sensitivity audit of other modules (task 16).
