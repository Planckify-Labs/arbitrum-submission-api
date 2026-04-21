import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsString, Matches, Min } from "class-validator";

/**
 * Body for `POST /v1/pay/intents/:id/deposit-receipt` (task 38, spec §6.2).
 *
 * Three-role separation (memory `feedback_role_separation.md`): the server
 * verifies the txHash on-chain against the payer's wallet and the Gateway
 * wallet contract before trusting any claim the mobile makes here. Every
 * field on this DTO is either verifiable against the tx receipt
 * (`txHash`, `chainId`) or metadata we cross-check against the persisted
 * intent (`amountMicros`) / audit flag we persist as-is
 * (`usedCirclePaymaster`).
 *
 * Shape note: the spec §6.2 snippet calls this field `useCirclePaymaster`.
 * Task 19 landed the Prisma column as `usedCirclePaymaster` (past tense —
 * the deposit already happened by the time mobile POSTs here). We keep
 * the field name aligned with the persisted column so the audit trail
 * stays self-describing; if a future spec pass renames the column we
 * flip both sides in lockstep.
 */
export class DepositReceiptDto {
  /**
   * 32-byte tx hash of the Gateway deposit UserOp / direct deposit the
   * onboarding screen just confirmed. We verify this on-chain before
   * persisting.
   */
  @ApiProperty({
    description:
      "On-chain txHash of the USDC deposit into Circle GatewayWallet. Verified server-side.",
    example: "0x" + "a".repeat(64),
  })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{64}$/, {
    message: "txHash must be `0x` + 64 hex characters (32 bytes).",
  })
  txHash!: `0x${string}`;

  /**
   * EVM chain id the deposit landed on. We cross-check against the
   * persisted intent's `usdcSourceChainId` and the BlockchainVerification
   * client map — if Circle Gateway isn't deployed there, the
   * BlockchainVerificationService rejects.
   */
  @ApiProperty({
    description: "EVM chain id the deposit tx landed on (source chain).",
    example: 5042002,
  })
  @IsInt()
  @Min(1)
  chainId!: number;

  /**
   * USDC atomic (6-decimal) amount deposited, as a decimal string so
   * bigint precision survives JSON. Cross-checked against the tx's
   * transfer value during verification.
   */
  @ApiProperty({
    description:
      "USDC atomic (6-decimal) amount deposited as a decimal string.",
    example: "1000000",
  })
  @IsString()
  @Matches(/^\d+$/, {
    message: "amountMicros must be a positive integer (decimal string).",
  })
  amountMicros!: string;

  /**
   * Audit flag — `true` if the mobile submitted the deposit via
   * Circle Paymaster (task 35) so we never charged the user gas,
   * `false` if the payer paid gas themselves (Arc native, or a
   * fallback after paymaster unavailability). Persisted verbatim.
   */
  @ApiProperty({
    description:
      "Audit flag: `true` if Circle Paymaster sponsored the deposit UserOp, `false` otherwise.",
    example: true,
  })
  @IsBoolean()
  usedCirclePaymaster!: boolean;
}

/**
 * Response for `POST /v1/pay/intents/:id/deposit-receipt`.
 *
 * Spec ref: umkm-usdc-payout-spec.md §6.2 `DepositReceiptResponse`. The
 * mobile onboarding screen polls this to know when it can advance into
 * the Nanopay settle path — the `status` field is the canonical signal.
 * `gasless.requiresDeposit` on the joined intent flips to `false` only
 * once this response's `status === "CONFIRMED"`.
 */
export class DepositReceiptResponseDto {
  @ApiProperty({ description: "GatewayDeposit row id (ULID)." })
  depositId!: string;

  @ApiProperty({
    description:
      "Deposit status. `PENDING_ATTESTATION` while Circle's ledger hasn't confirmed; `CONFIRMED` when spendable; `FAILED` on a terminal error.",
    enum: ["PENDING_ATTESTATION", "CONFIRMED", "FAILED"],
  })
  status!: "PENDING_ATTESTATION" | "CONFIRMED" | "FAILED";
}
