import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNumber, IsString, Matches, Max, Min } from "class-validator";

/**
 * DCA v1 request bodies (mobile-app docs/defi-quick-invest-spec.md §12.3a).
 *
 * **There is deliberately no wallet-address field on any DTO here, and there
 * must never be one.** The plan's owner comes from the JWT via the
 * controller's `getWalletAddress(req)`, exactly as every other wallet-scoped
 * strategies endpoint already works. A caller cannot supply a wrongly-cased
 * address because a caller cannot supply an address at all — which makes the
 * "lowercased a base58 Solana address and the row was never found again" bug
 * unrepresentable rather than merely warned about.
 *
 * §12.8 makes this checkable: grepping these DTOs for a wallet field is an
 * automatic fail.
 */

/** Weekly or monthly only at launch (§12.6). */
export const ALLOWED_CADENCE_DAYS = [7, 30] as const;
export const RISK_TIERS = ["conservative", "balanced", "aggressive"] as const;

export class CreateRecurringInvestPlanDto {
  @ApiProperty({
    description:
      'CAIP-2 chain id the plan runs on, e.g. "eip155:8453", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "stellar:pubnet". Not a numeric chain id: that is EVM-shaped and degenerates to 0 elsewhere.',
    example: "eip155:8453",
  })
  @IsString()
  // Shape only. That the id resolves to a chain this deployment actually
  // serves is checked against the Blockchain table at create time, since a
  // well-formed id for an unknown chain is still an unusable plan.
  @Matches(/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/, {
    message: "caip2Id must look like <namespace>:<reference>",
  })
  caip2Id: string;

  @ApiProperty({ description: 'Asset the plan invests, e.g. "USDC".' })
  @IsString()
  assetSymbol: string;

  @ApiProperty({ description: "Amount per cycle, in USD (§6.2)." })
  @IsNumber()
  @Min(1)
  // A ceiling here is a guardrail, not a product limit: an accidental extra
  // zero on a standing order is worse than on a one-off deposit because it
  // repeats. Users wanting more can still deposit directly.
  @Max(100_000)
  amountUsd: number;

  @ApiProperty({ enum: RISK_TIERS })
  @IsIn(RISK_TIERS as unknown as string[])
  tier: string;

  @ApiProperty({
    enum: ALLOWED_CADENCE_DAYS,
    description:
      "7 (weekly) or 30 (monthly). An arbitrary day count invites plans whose gas cost eats a meaningful share of a small recurring deposit.",
  })
  @IsIn(ALLOWED_CADENCE_DAYS as unknown as number[])
  cadenceDays: number;
}

export class UpdateRecurringInvestPlanDto {
  @ApiProperty({
    enum: ["active", "paused", "cancelled"],
    description:
      "Cancelling is terminal: a cancelled plan can never go back to active, so the user is never surprised by a standing order they thought they had ended.",
  })
  @IsIn(["active", "paused", "cancelled"])
  status: string;
}
