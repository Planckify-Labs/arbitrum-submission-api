import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Ops review decision values — mapped onto the `QrisClaimDisputeStatus`
 * enum (spec §6.6, `prisma/schema.prisma`):
 *
 *   "confirm" → `resolved_valid`   (the existing claim stands)
 *   "revoke"  → `resolved_invalid` (PAN is freed; complainant can re-claim)
 *
 * We keep the wire-level vocabulary short ("confirm" / "revoke") so ops
 * tools surface plain verbs; the DB enum retains the audit-friendly
 * resolved_* shape so a status read is unambiguous post-review.
 */
export type ReviewDecision = "confirm" | "revoke";

export class ReviewClaimDto {
  @ApiProperty({
    description:
      "`confirm` keeps the existing claim (disputeStatus=resolved_valid). `revoke` invalidates it, frees the PAN, and sets disputeStatus=resolved_invalid so another merchant can claim.",
    enum: ["confirm", "revoke"],
    example: "revoke",
  })
  @IsIn(["confirm", "revoke"], {
    message: "decision must be 'confirm' or 'revoke'.",
  })
  decision!: ReviewDecision;

  /**
   * Required free-text context from the ops reviewer — lands in the
   * audit log `metadata.note` and ties the DB mutation back to the
   * external dispute ticket (email / WhatsApp thread id, etc). No
   * `@IsOptional` — per §12 Q9 every review must be explainable.
   */
  @ApiProperty({
    description:
      "Reviewer note — required. Goes into the admin audit log alongside the decision. Cite the external dispute ticket or WhatsApp thread id.",
    example: "WA ticket #4411: complainant provided original Xendit receipt.",
    minLength: 4,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(4, { message: "note must be at least 4 characters." })
  @MaxLength(2000, { message: "note must be ≤ 2000 characters." })
  note!: string;
}
