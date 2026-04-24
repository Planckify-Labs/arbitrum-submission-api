# Task 35 — Per-merchant settlement rail preference (deferred — Phase 6)

**Status:** Not taken (blocked until staging bake is stable)
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.2 item 3, §10 Phase 6

## Why this matters

Once the onchain rail is proven in staging, individual merchants should
be assignable to a preferred rail without changing the global env. This
enables gradual rollout — onboard merchants one-by-one to the onchain
rail while the rest stay on nanopay.

## Scope

1. **Schema:** Add `Merchant.preferredSettlementRail String?` to
   `prisma/schema.prisma`. Nullable — `NULL` means "use default".
   Valid values: `"nanopay"`, `"onchain"`.

2. **Orchestrator update:** Insert merchant preference into the
   resolution precedence chain (§4.2):
   1. Per-intent `PaymentIntent.path` (highest).
   2. **Per-merchant `Merchant.preferredSettlementRail`** (new).
   3. Env default `PAYMENT_SETTLEMENT_RAIL`.

3. **Admin endpoint (optional):** `PATCH /admin/merchants/:id` to set
   `preferredSettlementRail`. Or via direct DB update for v1.

4. **Intent creation:** When creating an intent for a merchant with a
   preference, set `PaymentIntent.path` accordingly so the intent is
   pinned to the merchant's preferred rail at creation time.

## Rules (non-negotiable)

- **Do not start until staging bake (task 26) is stable** — at least
  1 week with no P0/P1 issues.
- **Nullable column.** Existing merchants default to env behavior.
- **Existing intents unaffected.** Only new intents pick up the
  merchant preference.

## Acceptance

- [ ] `Merchant.preferredSettlementRail` column exists.
- [ ] Orchestrator resolves merchant preference between per-intent and
      env default.
- [ ] Merchant with `preferredSettlementRail = "onchain"` → new intents
      use onchain rail.
- [ ] Merchant with `NULL` → falls through to env default.
- [ ] `pnpm run build` and `pnpm run test` pass.

## Out of scope

- Production cutover (ops decision).
- Per-merchant fee overrides (`MerchantTokenFeeOverride` — not in v1).
