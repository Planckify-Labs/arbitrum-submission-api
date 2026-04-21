import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Wire shape returned by `GET /admin/qris-claims` and the review endpoint.
 *
 * Kept separate from the Prisma model so we never accidentally leak
 * internal-only columns and so the evidence-photo field can switch
 * between a raw object-storage key (current v1 — no signed-URL helper
 * wired yet) and a short-lived signed URL without changing the caller.
 */
export class QrisClaimResponseDto {
  @ApiProperty({ example: "01HCLAIM0000000000000000000" })
  id!: string;

  @ApiProperty({ example: "01HMERCHANT00000000000000000" })
  merchantId!: string;

  @ApiProperty({ example: "936000091234567890" })
  qrisPan!: string;

  /**
   * Evidence photo. v1 returns the raw object-storage key because the
   * signed-URL helper isn't wired into this repo yet (grep for
   * `presigned` / `signedUrl` — no hits). Follow-up: when the storage
   * client ships, return `evidencePhotoUrl` (15 min expiry) alongside
   * or instead of the raw key.
   * TODO(task 45, follow-up): swap for signed-URL once storage helper lands.
   */
  @ApiProperty({
    example: "s3://takumipay-evidence/merchants/mch_01H/sticker.jpg",
    description:
      "Object-storage key of the sticker photo captured at signup. Signed-URL follow-up pending (TODO).",
  })
  stickerPhotoKey!: string;

  @ApiPropertyOptional({
    description:
      "Signed URL for the evidence photo. Null in v1 until the storage signed-URL helper is wired. Consume `stickerPhotoKey` with the ops object-storage creds meanwhile.",
    example: null,
    nullable: true,
  })
  evidencePhotoUrl?: string | null;

  @ApiProperty({
    enum: ["none", "open", "resolved_valid", "resolved_invalid"],
    example: "none",
  })
  disputeStatus!: "none" | "open" | "resolved_valid" | "resolved_invalid";

  @ApiProperty({ example: 1_730_000_000_000 })
  claimedAt!: number;

  @ApiProperty({ example: null, nullable: true })
  reviewedAt!: number | null;

  @ApiProperty({ example: 1_730_000_000_000 })
  createdAt!: number;

  @ApiProperty({ example: 1_730_000_000_000 })
  updatedAt!: number;
}
