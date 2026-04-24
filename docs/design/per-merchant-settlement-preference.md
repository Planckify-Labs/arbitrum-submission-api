# Per-Merchant Settlement Preference (Deferred)

## Design

Add `preferredSettlementRail` column to `Merchant` model:

```prisma
model Merchant {
  // ...existing fields...
  preferredSettlementRail String? // "nanopay" | "onchain" | null (use env default)
}
```

## Resolution order (updated)

1. **Per-intent:** `PaymentIntent.path` — if explicitly set at creation time, this takes highest precedence. Used when the customer's wallet or the mobile app knows which rail to use.

2. **Per-merchant:** `Merchant.preferredSettlementRail` — if the merchant has opted into a specific rail. Ops can set this per-merchant to gradually onboard merchants to the onchain rail.

3. **Env default:** `PAYMENT_SETTLEMENT_RAIL` — global fallback for all intents where neither per-intent nor per-merchant preference is set.

## Factory update

```ts
// SettlementOrchestratorService.resolveProvider (updated)
resolveProvider(key: string, merchant?: Merchant): IPaymentSettlementProvider {
  // 1. Per-intent explicit rail
  if (key === "nanopay" || key === "onchain" || key === "direct_arc") {
    return this.resolveByKey(key);
  }

  // 2. Per-merchant preference
  if (merchant?.preferredSettlementRail) {
    return this.resolveByKey(merchant.preferredSettlementRail);
  }

  // 3. Env default
  const defaultRail = this.configService.get<string>(
    "PAYMENT_SETTLEMENT_RAIL",
    "nanopay",
  );
  return this.resolveByKey(defaultRail);
}
```

## Migration

```sql
ALTER TABLE "Merchant" ADD COLUMN "preferredSettlementRail" TEXT;
```

No backfill needed — `NULL` means "use env default", which preserves existing behavior.

## Admin API

Add a `PATCH /v1/admin/merchants/:id` endpoint (or extend existing) to set:

```json
{
  "preferredSettlementRail": "onchain"
}
```

Validate against allowed values: `"nanopay" | "onchain" | null`.

## Rollout strategy

1. Deploy the migration + code with no merchants configured
2. Ops manually sets `preferredSettlementRail = "onchain"` for test merchants
3. After validation, gradually expand to all merchants
4. Once all merchants are on onchain, flip the env default

## When to implement

After staging bake is stable (Phase 6 complete, 2+ weeks green).
Prerequisites:
- Onchain settlement provider tested and stable in staging
- At least 100 successful onchain settlements without failure
- Monitoring alerts (task 27) confirmed operational
- Mobile coordination (task 38) validated with real devices
