# Task 19 — `POST /v1/pay/intents/:id/onchain` controller + DTO

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.3

## Why this matters

This is the API surface mobile calls after the customer's on-chain
transaction confirms. It receives the `txHash` + `chainId`, delegates
to `SettlementOrchestratorService.settleAndKickPayout`, and returns
the settlement status. Without this endpoint, mobile has no way to
trigger backend verification of an onchain payment.

## Scope

Add to `src/pay/intents.controller.ts` (or a new settlement controller):

```ts
@Post(":id/onchain")
async submitOnchain(
  @Param("id") intentId: string,
  @Body() dto: OnchainSubmitDto,
  @Req() req,
): Promise<SettlementSubmitResponseDto> {
  // 1. Load intent (assert exists, assert status allows submission)
  // 2. Build PayerInput { kind: "txHash", txHash: dto.txHash, chainId: dto.chainId }
  // 3. Call orchestrator.settleAndKickPayout(intent, merchant, payerInput)
  // 4. Map SettleReceipt to response DTO
}
```

**DTO:**

```ts
class OnchainSubmitDto {
  @IsString()
  txHash: string;    // 0x-prefixed tx hash

  @IsInt()
  chainId: number;   // EVM chain ID
}
```

**Response:** Reuse the existing `NanopaySubmitResponseDto` shape (or
whatever the current response DTO is). The response is rail-agnostic —
mobile's polling code is already blind to the rail. Rename to
`SettlementSubmitResponseDto` is cosmetic and out of scope.

**Status codes:**
- 200 — settled or idempotent replay.
- 202 — verification in progress (`SETTLING`).
- 409 — intent already settled with a different txHash.
- 400 — validation error (missing/invalid fields).
- 404 — intent not found.

## Rules (non-negotiable)

- **JWT-authenticated.** The caller must be the intent's payer.
- **Intent status guard.** Only `QUOTED` or `SIGNED` intents accept
  onchain submission. `SETTLED` / `PAID_OUT` / `FAILED` / `EXPIRED` →
  appropriate error.
- **`txHash` validation.** Must be a valid 0x-prefixed 66-char hex
  string.
- **Swagger documentation.** Add `@ApiTags`, `@ApiOperation`,
  `@ApiResponse` decorators.

## Acceptance

- [ ] `POST /v1/pay/intents/:id/onchain` endpoint exists and is
      documented in Swagger.
- [ ] Correct DTO validation (txHash format, chainId integer).
- [ ] Delegates to `SettlementOrchestratorService`.
- [ ] Status codes match the spec (200, 202, 409, 400, 404).
- [ ] JWT auth required — unauthorized → 401.
- [ ] `pnpm run build` passes.

## Out of scope

- Adapter implementation (task 18).
- Nanopay endpoint changes (none — existing endpoint untouched).
- Response DTO rename (cosmetic — §13 non-goal).
