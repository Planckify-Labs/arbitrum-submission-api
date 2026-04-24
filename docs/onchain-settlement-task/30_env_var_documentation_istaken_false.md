# Task 30 — Add all new env vars to `.env.example` and validate in ConfigService

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §6

## Why this matters

Six new env vars are introduced by this feature. If they're not
documented in `.env.example` with defaults, developers will hit
cryptic runtime errors. If they're not validated at boot, misconfigured
prod deployments fail silently.

## Scope

Add to `.env.example` with comments and defaults:

```env
# --- Onchain Settlement Rail ---
# Default rail when PaymentIntent.path is unset at creation: "nanopay" | "onchain"
PAYMENT_SETTLEMENT_RAIL=nanopay

# Per-rail confirmation override (only OnchainSettlementProvider). Falls back to MIN_CONFIRMATIONS.
# Per-chain Blockchain.minConfirmations takes higher precedence.
# ONCHAIN_MIN_CONFIRMATIONS=12

# EIP-712 signer for QuoteCommitment. Falls back to ADMIN_WALLET_PRIVATE_KEY.
# Must be distinct from ADMIN_WALLET_PRIVATE_KEY in production.
# QUOTE_SIGNER_PRIVATE_KEY=0x...

# TTL for direct_arc quotes in seconds (default 15 min)
QUOTE_TTL_DIRECT_ARC_SECONDS=900

# EIP-712 domain — must match contract's domain separator
QUOTE_SIGNATURE_DOMAIN_NAME=TakumiPay
QUOTE_SIGNATURE_DOMAIN_VERSION=1
```

**Validation** — ensure each var is read via `ConfigService` (not raw
`process.env`) in its consuming service:

| Var | Consumer |
|---|---|
| `PAYMENT_SETTLEMENT_RAIL` | `SettlementOrchestratorService` (task 11) |
| `ONCHAIN_MIN_CONFIRMATIONS` | `OnchainSettlementProvider` (task 18) |
| `QUOTE_SIGNER_PRIVATE_KEY` | `QuoteSignerService` (task 13) |
| `QUOTE_TTL_DIRECT_ARC_SECONDS` | `IntentsService.createIntent` (task 15) |
| `QUOTE_SIGNATURE_DOMAIN_NAME` | `QuoteSignerService` (task 13) |
| `QUOTE_SIGNATURE_DOMAIN_VERSION` | `QuoteSignerService` (task 13) |

Verify that the existing vars listed as "untouched" in §6
(`MIN_CONFIRMATIONS`, `CIRCLE_X402_SUPPORTED_URL`, etc.) are NOT
modified by any task.

## Rules (non-negotiable)

- **All vars in `.env.example`** with descriptive comments and defaults.
- **ConfigService access**, not `process.env`. Consistent with existing
  codebase convention.
- **Commented-out for optional vars** (e.g., `QUOTE_SIGNER_PRIVATE_KEY`
  — falls back to admin key in dev).

## Acceptance

- [ ] `.env.example` updated with all six vars.
- [ ] Each var has a comment explaining purpose + default.
- [ ] `grep -rn 'process.env.PAYMENT_SETTLEMENT\|process.env.QUOTE_'` in
      `src/` returns zero hits (all via ConfigService).
- [ ] Existing vars unchanged.
- [ ] `pnpm run build` passes.

## Out of scope

- Actually setting values in staging/prod (task 26).
