# Task 04 — Prisma: `OnchainSettlement` model + migration

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §5.1

## Why this matters

The `OnchainSettlement` model mirrors `NanopaySubmission` — it gives
each intent symmetric history-tracking regardless of which rail settled
it. The adapter (task 18) writes this row on successful verification;
idempotency and the audit trail depend on it existing.

## Scope

Add to `prisma/schema.prisma`:

```prisma
model OnchainSettlement {
  id             String        @id @default(ulid())
  intent         PaymentIntent @relation(fields: [intentId], references: [id], onDelete: Cascade)
  intentId       String
  txHash         String
  chainId        Int
  confirmations  Int?
  verifiedAt     DateTime?     @db.Timestamptz()
  failureCode    String?
  failureMessage String?
  createdAt      DateTime      @default(now()) @db.Timestamptz()

  @@unique([intentId, txHash])
  @@index([txHash])
}
```

- Add the inverse relation on `PaymentIntent` (`onchainSettlements OnchainSettlement[]`).
- Generate and apply the Prisma migration.
- Run `bash scripts/lint-migrations.sh`.
- Regenerate Prisma client (`pnpm prisma generate`).

## Rules (non-negotiable)

- **`@@unique([intentId, txHash])`** is the idempotency key — replay
  with the same tx returns the prior row (§4.4).
- **`onDelete: Cascade`** mirrors `NanopaySubmission`'s behavior.
- **No application code changes.** This is schema-only.
- **No FK to hypertable.** `OnchainSettlement` itself is NOT a
  hypertable and does not reference one.

## Acceptance

- [ ] `prisma/schema.prisma` has `OnchainSettlement` model with all
      columns from §5.1.
- [ ] `PaymentIntent` model has the inverse `onchainSettlements` relation.
- [ ] `pnpm prisma migrate dev` applies cleanly.
- [ ] `bash scripts/lint-migrations.sh` passes.
- [ ] `pnpm prisma generate` succeeds without type errors.

## Out of scope

- Writing to this model from application code (task 18).
- `PaymentIntent` column renames/additions (tasks 05, 06).
