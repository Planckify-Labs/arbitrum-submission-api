import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, Matches } from "class-validator";

/**
 * Body for `POST /v1/pay/intents/:id/nanopay`.
 *
 * Spec ref: umkm-usdc-payout-spec.md §6.2 `NanopaySubmitRequest`.
 *
 * The only field the payer supplies is the 65-byte EIP-3009 signature —
 * everything else the backend forwards to Circle (domain, amount, nonce,
 * from/to) comes from the persisted `PaymentIntent` row (three-role
 * separation, memory `feedback_role_separation.md`). The spec lists an
 * optional `payload` echo so the server can sanity-check mismatches
 * before calling Circle; we accept it but never trust any field — the DB
 * row is authoritative.
 */
export class SubmitNanopayDto {
  /**
   * 65-byte EIP-3009 signature as `0x`-prefixed hex. Circle's /settle
   * accepts the packed `r||s||v` form; we don't split it.
   *
   * Regex keeps validation cheap — `class-validator` will reject anything
   * that isn't exactly `0x` + 130 hex chars. The cryptographic check lives
   * at Circle (Nitro Enclave); doing ecrecover on our side buys us nothing
   * because Circle still has the final say on whether the signature
   * matches `from`.
   */
  @ApiProperty({
    description:
      "65-byte EIP-3009 signature produced by the mobile wallet, hex-encoded with `0x` prefix.",
    example: "0x" + "aa".repeat(65),
  })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{130}$/, {
    message: "signature must be `0x` + 130 hex characters (65 bytes).",
  })
  signature!: `0x${string}`;

  /**
   * Optional echo of the fields from `PaymentIntent.nanopay` so the server
   * can detect mismatches client-side before forwarding. If present, its
   * shape is the `NanopayPayload` discriminated union (EVM or SVM). The
   * controller Zod-shape check is intentionally loose — we re-hydrate
   * every field Circle cares about from the DB row anyway.
   */
  @ApiProperty({
    required: false,
    description:
      "Optional echo of the `PaymentIntent.nanopay` block. Server compares selected fields against the persisted intent and rejects mismatches as SIGNATURE_INVALID. Any field the server did not set is ignored.",
  })
  @IsOptional()
  payload?: Record<string, unknown>;
}
