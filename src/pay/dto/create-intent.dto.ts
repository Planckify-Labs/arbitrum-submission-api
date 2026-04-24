import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from "class-validator";

/**
 * Body shape for `POST /v1/pay/intents`.
 *
 * Three-role separation (memory `feedback_role_separation.md`): the server
 * computes USDC amount, FX snapshot, treasury, nonce, EIP-712 domain, and
 * validity window. The client submits only what the payer typed and which
 * merchant was scanned. Any client-supplied USDC / treasury / nonce is
 * ignored — the property whitelist enforced by `ValidationPipe` (global in
 * `main.ts`) drops unknown fields before they ever reach the service.
 *
 * Spec ref: umkm-usdc-payout-spec.md §6.2 `CreateIntentRequest`.
 */
export class CreateIntentDto {
  /**
   * Merchant ULID. Either `merchantId` or `scannedPayload` MUST be present,
   * enforced at service layer (class-validator can't express XOR across two
   * optional fields without a custom validator — service-level check keeps
   * the error message explicit).
   */
  @ApiPropertyOptional({
    description: "Merchant id resolved client-side from the scanned TakumiPay JWS.",
  })
  @IsOptional()
  @IsString()
  merchantId?: string;

  @ApiPropertyOptional({
    description:
      "Raw QRIS / EMVCo payload when the client couldn't resolve the merchant itself. " +
      "Server parses and resolves. Reserved for M3; accepted as an opaque string here.",
  })
  @IsOptional()
  @IsString()
  scannedPayload?: string;

  /**
   * Fiat amount in minor units (IDR has 2 decimals by ISO-4217 but domestic
   * QRIS convention treats IDR as integer units — the mobile side sends the
   * whole-rupiah integer here as required by the spec §6.6 `fiat_amount_minor`).
   */
  @ApiProperty({
    description: "Amount the user typed, in minor units for `currency`.",
    example: 15000,
  })
  @IsInt()
  @Min(1)
  fiatAmountMinor!: number;

  /**
   * M2 restriction: Indonesia only. Expanding this enum is an explicit
   * milestone gate (§12), not a DTO relax — new currencies need matching
   * FX rows, Xendit channel tables, and payout flow testing first.
   */
  @ApiProperty({
    description: "Fiat currency. M2 accepts IDR only.",
    enum: ["IDR"],
  })
  @IsEnum(["IDR"])
  currency!: "IDR";

  /**
   * Optional payer-chain hint for the backend when selecting the settlement
   * rail (task 43 / spec §5.2.1). When omitted or `"evm"`, the intent is
   * minted as an EVM Nanopayments (EIP-3009) intent bound to the Arc
   * treasury. When `"solana"`, the intent is minted with the SVM facilitator
   * domain and the platform's Solana treasury address.
   *
   * Mobile derives this from the active wallet namespace at intent-creation
   * time. The server does NOT branch on this field for EVM — `"evm"` is the
   * default, so omitting the field is equivalent to passing `"evm"` and
   * keeps backward compat with pre-task-43 clients.
   *
   * Chain-extension discipline (memory `feedback_chain_extension_discipline.md`):
   * one intent is one chain — an intent minted for SVM cannot be settled on
   * EVM and vice-versa. The scheme is frozen at quote time.
   */
  @ApiPropertyOptional({
    description:
      "Payer's preferred settlement namespace. `evm` (default) → Arc + Nanopayments; `solana` → Path B-SVM.",
    enum: ["evm", "solana"],
  })
  @IsOptional()
  @IsIn(["evm", "solana"])
  preferredChain?: "evm" | "solana";

  @ApiPropertyOptional({
    description: "Token.id (ULID) from mobile picker. Required for onchain rail.",
  })
  @IsOptional()
  @IsString()
  sourceTokenId?: string;
}

/**
 * Idempotency header guard — 32..64 chars per the user's M2 contract. We
 * accept any printable string in that length band (UUID fits, so does a
 * ULID prefix, so does a random 48-char token). The hash of the request
 * body disambiguates collisions; see `intents.service.ts`.
 */
export class IdempotencyKeyDto {
  @IsString()
  @Length(32, 64)
  key!: string;
}
