import { ApiProperty } from "@nestjs/swagger";
import { IsBase64, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Body for `POST /v1/pay/intents/:id/nanopay-svm` (task 43 / spec §5.2.1
 * Path B-SVM). Mobile's task-42 signer produces a base64-encoded, partially-
 * signed Solana versioned transaction; backend forwards the opaque string to
 * Circle's Solana x402 facilitator.
 *
 * Three-role separation (memory `feedback_role_separation.md`): backend does
 * NOT parse the tx bytes — we keep `@solana/web3.js` off the backend per task
 * 43 Constraints. The facilitator validates the payer signature, adds its
 * fee-payer signature, and submits.
 */
export class SubmitNanopaySvmDto {
  /**
   * Base64-encoded Solana versioned transaction. Payload is ComputeBudget ×
   * 2 + TransferChecked (+ optional Memo) per spec §5.2.1; backend treats it
   * as opaque bytes.
   *
   * Length guard is loose on purpose — a typical Solana tx with ATA derivation
   * and one TransferChecked instruction serializes to ~400 bytes → ~540 chars
   * base64. We cap at 8 KB base64 (~6 KB decoded) so an attacker can't stuff
   * megabytes into the JSON parse — Circle's max tx size is 1232 bytes on
   * Solana, so anything much larger is malformed by definition.
   */
  @ApiProperty({
    description:
      "Base64-encoded signed Solana versioned transaction produced by the mobile wallet.",
    example: "AQIDBAUGBwgJCg==",
  })
  @IsString()
  @IsBase64()
  @MinLength(16, { message: "signedTransaction is too short to be a valid Solana tx." })
  @MaxLength(8192, {
    message: "signedTransaction exceeds 8 KB base64 cap.",
  })
  signedTransaction!: string;
}
