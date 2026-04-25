import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { QuoteCommitmentResponseDto } from "./quote-commitment-response.dto";

/**
 * Wire shape of the Nanopay authorization block inside
 * `PaymentIntentResponse`. Mirrors the mobile-side `NanopayPayload` in
 * `services/nanopay/types.ts` (task 17). Fields are load-bearing: the
 * mobile app signs an EIP-712 `TransferWithAuthorization` struct built
 * from EXACTLY these values — any schema drift here breaks the wallet
 * signature path silently (Circle rejects at settle, not at verify).
 *
 * The `value` and `nonce` are strings so bigint precision survives JSON.
 *
 * SVM note (task 43 / spec §5.2.1): when `kind = "svm_partial_tx"` the EVM
 * domain fields go unused and the backend populates `cluster`, `usdcMint`,
 * and the base64 `transaction` blob the mobile signer will add its signature
 * over. A single response DTO covers both schemes — consumers discriminate
 * on `kind`. Exposing SVM-only fields as optional keeps the wire shape a
 * strict superset of the EVM-only legacy.
 */
export class NanopayPayloadResponseDto {
  @ApiPropertyOptional({
    description:
      "Discriminator — which x402 scheme the payer signs. Omitted for EVM on legacy responses (treated as `evm_eip3009`).",
    enum: ["evm_eip3009", "svm_partial_tx"],
  })
  kind?: "evm_eip3009" | "svm_partial_tx";

  @ApiPropertyOptional({
    description:
      "SVM cluster — only populated when `kind = svm_partial_tx`. CAIP-2 reference is `solana:mainnet` / `solana:devnet`.",
    enum: ["mainnet-beta", "devnet"],
  })
  cluster?: "mainnet-beta" | "devnet";

  @ApiPropertyOptional({
    description:
      "USDC SPL mint address (base58). Only populated for SVM intents. Mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.",
  })
  usdcMint?: string;

  @ApiPropertyOptional({
    description:
      "Base64-encoded unsigned Solana versioned transaction the mobile wallet will sign. Only populated for SVM intents.",
  })
  transaction?: string;

  @ApiPropertyOptional({
    description:
      "Facilitator fee-payer pubkey (base58) that will co-sign and submit. Only populated for SVM intents.",
  })
  feePayer?: string;

  @ApiPropertyOptional({
    description:
      "USDC asset contract address on the source chain. EVM-only — for SVM intents, see `usdcMint`.",
  })
  usdc?: `0x${string}`;

  @ApiProperty({ description: "Source chain the payer debits USDC from (EVM chainId or sentinel for SVM)." })
  sourceChainId!: number;

  @ApiPropertyOptional({
    description:
      "EIP-712 domain. `verifyingContract` is Circle's GatewayWallet contract. EVM-only.",
  })
  domain?: {
    name: string;
    version: string;
    verifyingContract: `0x${string}`;
  };

  @ApiPropertyOptional({
    description: "Payer EOA (`from` field of the EIP-3009 struct). EVM-only.",
  })
  from?: `0x${string}`;

  @ApiPropertyOptional({
    description: "Platform treasury EOA (`to` field of the EIP-3009 struct). EVM-only.",
  })
  to?: `0x${string}`;

  @ApiProperty({
    description: "USDC atomic (6-decimal) amount as a decimal string to preserve bigint precision.",
  })
  value!: string;

  @ApiProperty({ description: "Unix seconds; authorization is invalid before this time." })
  validAfter!: number;

  @ApiProperty({
    description:
      "Unix seconds. Circle Gateway requires `validBefore ≥ now + 259_200` (3 days) or settle fails with `authorization_validity_too_short`.",
  })
  validBefore!: number;

  @ApiPropertyOptional({
    description:
      "32-byte random, server-generated per intent. Hex-encoded with `0x` prefix. EVM-only — SVM intents carry the random bytes inside `transaction` via a Memo.",
  })
  nonce?: `0x${string}`;
}

/**
 * Response shape of `POST /v1/pay/intents` (and, by §6.2, `GET /v1/pay/intents/:id`).
 * Matches the mobile's `PaymentIntentResponse` in `services/nanopay/types.ts`.
 */
export class PaymentIntentResponseDto {
  @ApiProperty({ description: "Intent ULID." })
  id!: string;

  @ApiProperty({
    description: "Mobile-facing status string. Lowercase per the mobile type contract.",
    enum: ["pending", "submitting", "settling", "paid", "paid_out", "failed", "expired"],
  })
  status!: "pending" | "submitting" | "settling" | "paid" | "paid_out" | "failed" | "expired";

  @ApiProperty({
    description: "USDC atomic (6-decimal) amount. Decimal string to survive JSON bigint precision loss.",
  })
  nanopayUsdcAmountMicros!: string;

  @ApiProperty({
    description:
      "Source chain the payer debits from — EVM chainId for EVM intents, or a negative sentinel for SVM intents (`-101` = solana-mainnet, `-102` = solana-devnet).",
  })
  nanopayUsdcSourceChainId!: number;

  @ApiProperty({
    description:
      "Platform treasury address — EVM EOA (`0x…`) for EVM intents, Solana pubkey (base58) for SVM intents. Echoed from `nanopay.to` / `nanopay.feePayer` for convenience.",
  })
  nanopayUsdcTreasuryAddress!: string;

  @ApiPropertyOptional({
    description:
      "Nanopay EIP-712 payload to sign. `null` once consumed (post-settle) — reserved for future /GET reads.",
    type: NanopayPayloadResponseDto,
    nullable: true,
  })
  nanopay!: NanopayPayloadResponseDto | null;

  @ApiProperty({
    description: "Unix milliseconds the intent expires at (nanopay validBefore + 60s buffer).",
  })
  expiresAt!: number;

  // --- GET /v1/pay/intents/:id extras (task 25) -----------------------------
  // These fields are populated on the polling endpoint so the mobile receipt
  // screen can render without a second merchant/payout lookup. They are
  // optional on the create-intent response (always `undefined`) so the wire
  // shape stays a strict superset of what mobile already consumes.

  @ApiPropertyOptional({
    description:
      "Merchant display name joined from `merchants.displayName`. Returned by GET, omitted by POST.",
  })
  merchantDisplayName?: string;

  @ApiPropertyOptional({
    description:
      "Merchant id — echoed on the receipt screen. Returned by GET, omitted by POST.",
  })
  merchantId?: string;

  @ApiPropertyOptional({
    description:
      "Fiat amount in minor units (e.g. IDR 15_000). Echoed so the receipt screen can format the original quote.",
  })
  fiatAmountMinor?: number;

  @ApiPropertyOptional({
    description: "Fiat currency of `fiatAmountMinor` (e.g. `IDR`).",
  })
  currency?: string;

  @ApiPropertyOptional({
    description:
      "FX rate snapshot as a decimal string (e.g. `15700`). Echoed so the receipt screen can show the applied quote.",
  })
  fxRate?: string;

  @ApiPropertyOptional({
    description: "Intent creation time — Unix milliseconds.",
  })
  createdAt?: number;

  @ApiPropertyOptional({
    description:
      "Public payout reference id (Xendit `reference_id`). Populated once the intent reaches a terminal payout state.",
    nullable: true,
  })
  payoutReferenceId?: string | null;

  @ApiPropertyOptional({
    description:
      "Unix milliseconds the payout completed at. Populated only when `status = paid_out`.",
    nullable: true,
  })
  settledAt?: number | null;

  // --- Onchain settlement quote fields (Phase 3, task 15) --------------------
  // Populated when the intent targets an onchain settlement rail. The mobile
  // app uses these to build the on-chain `payWithQuote(...)` transaction.

  @ApiPropertyOptional({
    description:
      "EIP-712 quote commitment the backend signed. Present when the intent uses the onchain settlement rail.",
    type: QuoteCommitmentResponseDto,
  })
  quoteCommitment?: QuoteCommitmentResponseDto;

  @ApiPropertyOptional({
    description:
      "Hex-encoded EIP-712 signature over `quoteCommitment`, signed by the platform's quote signer key. " +
      "Passed verbatim as the `signature` arg to the on-chain `payWithQuote` function.",
  })
  quoteSignature?: string;
}
