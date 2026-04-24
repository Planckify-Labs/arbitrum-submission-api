# Mobile Coordination — Onchain Settlement Rail

## refId = intentId

When calling `processMerchantPayment` on the TakumiWallet contract, mobile
MUST pass `intent.id` (the ULID returned by `POST /v1/pay/intents`) as the
`refId` field in the `QuoteCommitment` struct.

This is a non-negotiable invariant: the backend uses `refId` to look up the
`MerchantPayment` struct on-chain and cross-reference it against the
`PaymentIntent` row. If `refId` does not match `intent.id`, verification
will fail with `REF_NOT_ON_CHAIN`.

## Quote consumption flow

1. `POST /v1/pay/intents` returns:
   - `quoteCommitment` — the exact struct to pass to the contract
   - `quoteSignature` — the backend's EIP-712 signature
   - `expiresAt` — quote validity deadline (ISO 8601)

2. Mobile shows countdown: `expiresAt - 60s` safety margin.
   - This margin ensures the customer does not broadcast a tx at T-1s that
     confirms after `expiresAt`, which would cause a `QUOTE_EXPIRED` revert
     (gas spent, no tokens moved).

3. If customer pays before expiry:
   - Call `TakumiWallet.processMerchantPayment(quoteCommitment, quoteSignature)`
   - On tx confirmation, call `POST /v1/pay/intents/:id/onchain { txHash, chainId }`

4. If countdown expires:
   - Fire `POST /v1/pay/intents` with a NEW `Idempotency-Key`
   - Old intent expires via backend sweeper
   - Do NOT reuse the prior `Idempotency-Key` — that returns the stale intent

## Request format

```
POST /v1/pay/intents/:id/onchain
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "txHash": "0xabc123...",   // 66-char hex transaction hash
  "chainId": 5042002          // numeric chain ID matching the intent
}
```

## Response polling

After `POST /v1/pay/intents/:id/onchain`:

| Response `status` | Meaning | Mobile action |
|---|---|---|
| `SETTLED` | Payment verified, payout in progress | Show success screen |
| `SETTLING` | Verification in progress (e.g. waiting for confirmations) | Poll `GET /v1/pay/intents/:id` |
| `FAILED` | Terminal failure | Show error code, prompt retry or re-quote |

Poll `GET /v1/pay/intents/:id` every 3 seconds until terminal status
(`SETTLED`, `PAID_OUT`, or `FAILED`).

## Failure codes (mobile should handle)

| Code | Meaning | Mobile UX |
|---|---|---|
| `TX_REVERTED` | Transaction reverted on-chain | Show "transaction failed" |
| `SENDER_MISMATCH` | Tx sender != intent payer | Show "wrong wallet" |
| `RECIPIENT_MISMATCH` | Tx recipient != TakumiWallet | Show "wrong contract" |
| `REF_NOT_ON_CHAIN` | refId not found on-chain | Show "payment not found" |
| `CONTRACT_DATA_MISMATCH` | On-chain data != intent data | Show "verification failed" |
| `INTENT_ALREADY_SETTLED` | Intent already settled | Show success (idempotent) |
| `TIMEOUT` | Verification timed out | Auto-retry or show "verifying..." |

## ERC-20 approval flow

For ERC-20 tokens (USDC, USDT), mobile MUST ensure sufficient allowance
before calling `processMerchantPayment`:

```
1. Check: allowance(payer, takumiWalletContract) >= quoteCommitment.amount
2. If insufficient: approve(takumiWalletContract, quoteCommitment.amount)
3. Then: processMerchantPayment(quoteCommitment, quoteSignature)
```

For native tokens (ETH, MATIC), pass `msg.value = quoteCommitment.amount`
and skip the approval step.

## Token selection

The `sourceTokenId` field in `POST /v1/pay/intents` determines which token
the customer pays with. Mobile should present a token picker showing only
tokens where `Token.isPaymentEnabled = true` (available via `GET /v1/tokens`
or similar).

## Idempotency-Key lifecycle

- Generate a fresh ULID for each new intent creation
- Reusing an `Idempotency-Key` with the same body returns the cached intent
- Reusing an `Idempotency-Key` with a different body returns HTTP 409
- After a quote expires and the user re-quotes, always use a new key
