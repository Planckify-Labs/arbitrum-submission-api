# Task 07 — Add `Token.isPaymentEnabled` + `Token.platformFeeBps`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §5.4

## Why this matters

`isPaymentEnabled` is the ops gate that controls which tokens are
accepted for merchant payment — distinct from `isActive` (which controls
wallet display). `platformFeeBps` stores the per-token platform fee
rate applied at quote time. Without these, there's no way to whitelist
tokens or compute fees.

## Scope

Add to `Token` in `prisma/schema.prisma`:

```prisma
isPaymentEnabled Boolean @default(false)
platformFeeBps   Int     @default(0)
```

- Generate and apply the Prisma migration.
- Seed USDC and USDT with `isPaymentEnabled = true` in the seed script
  (if a token seed exists). All other tokens remain `false`.
- `platformFeeBps` defaults to `0` — ops sets per-token values after
  finance sign-off.

## Rules (non-negotiable)

- **Default `false`** for `isPaymentEnabled` — tokens must be explicitly
  whitelisted.
- **Default `0`** for `platformFeeBps` — zero-fee is the safe default.
- **Valid range** for `platformFeeBps` is 0–1000 (0%–10%). Enforcement
  is at the application level (task 21), not DB constraint.
- No application-code changes beyond the seed script.

## Acceptance

- [ ] `prisma/schema.prisma` has both columns on `Token`.
- [ ] `pnpm prisma migrate dev` applies cleanly.
- [ ] Seed script sets USDC + USDT to `isPaymentEnabled = true` (if
      applicable).
- [ ] `bash scripts/lint-migrations.sh` passes.
- [ ] `pnpm prisma generate` succeeds.

## Out of scope

- Reading `isPaymentEnabled` in intent creation (task 20).
- Fee computation using `platformFeeBps` (task 21).
