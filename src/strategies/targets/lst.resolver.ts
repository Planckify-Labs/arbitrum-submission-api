/**
 * Tier 3 — liquid staking / restaking (Family F, spec §6.4, §12 Q2).
 *
 * A stake is a per-venue call into a rate-appreciating receipt, so the venue —
 * not the pool row — is the identity. `LST_VENUES` in the address-book pins the
 * entry contract, receipt, call shape and exit path; this resolver's job is to
 * match a DeFiLlama pool to one of them and emit `{ kind:"lst-stake", venue }`.
 *
 * **The exit is the hard part and it is carried on the target.** Most LSTs
 * redeem through a withdrawal queue (days) or a DEX swap, so `exit` drives the
 * UX: `"queue"` ships deposit-only with an honest "exit via withdrawal queue"
 * label until the Tier-4 request/claim machinery lands, at which point it
 * upgrades with no resolver or adapter change (§12 Q2). We never promise an
 * instant exit we cannot honour (§8.3).
 *
 * Wrapped receipts that are themselves ERC-4626 (e.g. `weETH`) are better
 * served by Family A — the 4626 resolvers run first, so those pools never
 * reach here.
 */

import { findLstVenuesForProject } from "./address-book";
import type { DepositTarget, PoolTargetResolver } from "./types";
import { eqAddr, resolveEvmChainId } from "./types";

/**
 * DeFiLlama's LST rows carry the receipt token in `underlyingTokens` for some
 * protocols and the staked asset for others, so the venue match is by
 * `(project, chain)` and the receipt is then cross-checked when the pool does
 * name a token we recognise.
 */
export const LstStakeResolver: PoolTargetResolver = {
  family: "lst-stake",
  aliases: [
    "lido",
    "lido-eth",
    "rocket-pool",
    "ether.fi-stake",
    "etherfi",
    "stader",
    "binance-staked-eth",
    "meth-protocol",
    "mantle-staked-eth",
    "benqi-staked-avax",
    "benqi-liquid-staking",
  ],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    const chainId = resolveEvmChainId(pool.chain);
    if (!chainId) return null;

    const venues = findLstVenuesForProject(pool.project, chainId);
    if (venues.length === 0) return null;

    // A protocol with several venues on one chain needs the pool to name the
    // receipt; otherwise there is nothing to disambiguate with and we refuse.
    let venue = venues[0];
    if (venues.length > 1) {
      const named = pool.underlyingTokens ?? [];
      const match = venues.find((v) =>
        named.some((t) => eqAddr(t, v.receipt) || eqAddr(t, v.asset)),
      );
      if (!match) return null;
      venue = match;
    }

    const target: DepositTarget = {
      kind: "lst-stake",
      venue: venue.key,
      receipt: venue.receipt,
      asset: venue.asset,
      exit: venue.exit,
    };
    return (await ctx.validate(target, pool)) ? target : null;
  },
};
