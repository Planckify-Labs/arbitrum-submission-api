export interface PlatformFeeResult {
  totalAmount: bigint;
  platformFeeAmount: bigint;
  merchantBackingAmount: bigint;
}

/**
 * Compute the total token amount the payer sends, given the merchant's
 * backing (the amount the merchant "receives" value-wise) and the
 * platform fee in basis points.
 *
 * Formula:
 *   total = merchantBacking / (1 - bps/10000)
 *         = merchantBacking * 10000 / (10000 - bps)
 *
 * The platform fee is the delta: total - merchantBacking.
 *
 * When `platformFeeBps <= 0`, no fee is applied and totalAmount equals
 * merchantBackingTokens.
 *
 * Spec ref: onchain-merchant-settlement-spec.md §4.7a.
 */
export function computePlatformFee(
  merchantBackingTokens: bigint,
  platformFeeBps: number,
): PlatformFeeResult {
  if (platformFeeBps <= 0) {
    return {
      totalAmount: merchantBackingTokens,
      platformFeeAmount: 0n,
      merchantBackingAmount: merchantBackingTokens,
    };
  }
  // total = merchantBacking / (1 - bps/10000)
  // = merchantBacking * 10000 / (10000 - bps)
  const totalAmount = merchantBackingTokens * 10000n / BigInt(10000 - platformFeeBps);
  const platformFeeAmount = totalAmount - merchantBackingTokens;
  return { totalAmount, platformFeeAmount, merchantBackingAmount: merchantBackingTokens };
}
