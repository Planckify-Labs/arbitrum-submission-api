import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Machine-readable failure enum mirroring the mobile
 * `services/nanopay/types.ts:NanopayFailureCode` (spec §6.2).
 *
 * Must stay in lockstep with the mobile type — the polling / receipt UI
 * switches on these strings exactly.
 */
export type NanopayFailureCode =
  | "SIGNATURE_INVALID"
  | "NONCE_REUSED"
  | "AUTHORIZATION_EXPIRED"
  | "INSUFFICIENT_GATEWAY_BALANCE"
  | "CIRCLE_UPSTREAM_ERROR"
  | "QUOTE_EXPIRED";

/**
 * Response shape of `POST /v1/pay/intents/:id/nanopay`.
 *
 * Three statuses the client can see:
 *   - `SETTLED`  — Circle accepted the authorization; Xendit fired.
 *   - `FAILED`   — Circle rejected or upstream outage; failure block populated.
 *   - `SETTLING` — Circle call timed out; row is in-flight, retry-safe.
 *                  Client should keep polling `GET /v1/pay/intents/:id`.
 *
 * Spec ref: umkm-usdc-payout-spec.md §6.2 `NanopaySubmitResponse`.
 */
export class NanopaySubmitResponseDto {
  @ApiProperty({ description: "Intent ULID this submission belongs to." })
  intentId!: string;

  @ApiProperty({
    enum: ["SETTLED", "FAILED", "SETTLING"],
    description:
      "Terminal-on-success, terminal-on-failure, or in-flight (timeout). " +
      "SETTLING means Circle call is still in flight on the server; client polls the intent for the terminal state.",
  })
  status!: "SETTLED" | "FAILED" | "SETTLING";

  @ApiPropertyOptional({
    description:
      "Populated when Circle accepted the authorization. `id` is Circle's `transaction` UUID; `receivedAt` is the server's wall clock when the settle returned.",
    nullable: true,
  })
  attestation!: { id: string; receivedAt: number } | null;

  @ApiPropertyOptional({
    description: "Populated when `status === FAILED`. Null on success/timeout.",
    nullable: true,
  })
  failure?: { code: NanopayFailureCode; message: string } | null;
}
