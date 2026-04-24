# Task 31 — Failure code translation: contract reverts + backend errors → wire response codes

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §8.1, §8.2 (last paragraph)

## Why this matters

Mobile's failure handling is rail-agnostic — it already speaks
`NanopayFailureCode` (or its equivalent). The onchain adapter produces
different internal failure codes (`TX_REVERTED`, `SENDER_MISMATCH`,
`CONTRACT_DATA_MISMATCH`, etc.) that must be translated to the
existing wire format so mobile doesn't need rail-specific error
handling.

## Scope

Create a translation layer (small mapping table) in the onchain adapter
or orchestrator:

**Backend failure codes → wire response:**

| Internal `failureCode` | Wire code (mobile-facing) | HTTP status |
|---|---|---|
| `TX_REVERTED` | Map to closest `NanopayFailureCode` | 422 |
| `SENDER_MISMATCH` | `"SENDER_MISMATCH"` or equivalent | 422 |
| `RECIPIENT_MISMATCH` | `"RECIPIENT_MISMATCH"` or equivalent | 422 |
| `REF_NOT_ON_CHAIN` | `"TX_NOT_FOUND"` or equivalent | 422 |
| `CONTRACT_DATA_MISMATCH` | `"VERIFICATION_FAILED"` or equivalent | 422 |
| `INTENT_ALREADY_SETTLED` | `"ALREADY_SETTLED"` | 409 |
| `PAYER_INPUT_WRONG_KIND` | `"INVALID_INPUT"` | 400 |
| (timeout / in-flight) | `"SETTLING"` | 202 |

**Contract revert reasons (§8.1) — mobile-side only, but document
the mapping:**

| Contract revert | Mobile UX action |
|---|---|
| `QUOTE_EXPIRED` | Prompt re-quote |
| `REF_CONSUMED` | Prompt re-quote + ops alert |
| `BAD_QUOTE` | Hard error + backend telemetry alert |
| `FEE_EXCEEDS_AMOUNT` | Hard error (P0 signer incident) |
| `NATIVE_AMOUNT_MISMATCH` | Client validation bug |
| `UNEXPECTED_NATIVE` | Client validation bug |

- Store `OnchainSettlement.failureCode` with the **internal** code.
- The controller / response DTO maps to the **wire** code.
- Document the mapping in a code comment or a `settlement-failure-codes.ts`
  constants file for mobile team reference.

## Rules (non-negotiable)

- **Mobile stays rail-agnostic.** Wire codes must be consumable by the
  existing mobile error-handling code without rail-specific branches.
- **`OnchainSettlement.failureCode`** stores the detailed internal code
  (for ops debugging). The wire response uses the translated code.
- **Contract revert reasons** are mobile-side — document them but don't
  implement mobile handling here.

## Acceptance

- [ ] Translation table exists in code (mapping function or constant map).
- [ ] Controller response uses translated wire codes, not raw internal codes.
- [ ] `OnchainSettlement.failureCode` stores the detailed internal code.
- [ ] Mapping is documented (code comments or constants file) for mobile
      team.
- [ ] `pnpm run build` passes.

## Out of scope

- Mobile-side revert handling (mobile team scope).
- Extending `NanopayFailureCode` enum if needed (may require a rename —
  cosmetic, per §13 non-goals).
