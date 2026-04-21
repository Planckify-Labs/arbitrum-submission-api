import { ApiProperty } from "@nestjs/swagger";

/**
 * Public projection of a `Channel` row, returned by
 * `GET /v1/merchants/channels?country=<iso>` (spec §6.0
 * `ChannelDescriptor`, §6.1 channels lookup).
 *
 * Filter-at-source: the DB is the source of truth for which channels
 * exist, what order they appear in the picker (`priority ASC`), and
 * which are active. Mobile renders in array order — no client-side
 * sort — so adding / renaming / disabling a channel is a single seed
 * re-run, not a mobile release.
 *
 * Chain-extension discipline: new countries add rows keyed by
 * `country` in the `Channel` table. No `country` branching in the
 * handler or on the wire.
 */
export class ChannelResponseDto {
  @ApiProperty({
    description: "Stable Xendit channel code (e.g. `GOPAY`, `BCA`).",
    example: "GOPAY",
  })
  channelCode!: string;

  @ApiProperty({
    description: "Customer-facing label, ready to render in the picker.",
    example: "GoPay",
  })
  label!: string;

  @ApiProperty({
    description: "Payout channel kind — either `ewallet` or `bank`.",
    example: "ewallet",
    enum: ["ewallet", "bank"],
  })
  kind!: "ewallet" | "bank";

  @ApiProperty({
    description:
      "Format hint for the mobile input — `phone_id` for Indonesian E.164 phones, `digits:N` for N-digit numeric account numbers. Stored as a string so ops can introduce new formats (e.g. `iban`) without a schema change.",
    example: "phone_id",
  })
  accountFormat!: string;

  @ApiProperty({
    description:
      "Display priority (lower = shown first). Server already orders the array by priority; clients MUST render in received order.",
    example: 10,
  })
  priority!: number;

  @ApiProperty({
    description:
      "Minimum disbursement amount accepted by Xendit for this channel, in IDR minor units (Rupiah). `null` if Xendit publishes no floor.",
    example: 10000,
    nullable: true,
  })
  minAmountIdr!: number | null;

  @ApiProperty({
    description:
      "Maximum disbursement amount accepted by Xendit for this channel, in IDR minor units (Rupiah). `null` if Xendit publishes no ceiling.",
    example: 20000000,
    nullable: true,
  })
  maxAmountIdr!: number | null;

  @ApiProperty({
    description:
      "Flat Xendit fee per disbursement on this channel, in IDR minor units (Rupiah).",
    example: 2500,
  })
  feeIdr!: number;
}
