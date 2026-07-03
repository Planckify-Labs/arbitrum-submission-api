/**
 * Suilend resolver (Sui) — spec §3.1, §5, §7.1 / Phase 3.
 *
 * Suilend is single-market-per-asset: one shared `LendingMarket<MAIN_POOL>` holds
 * every reserve, addressed by its slot in the `reserves` vector
 * (`reserve_array_index`). The resolver reads that vector on-chain and turns the
 * pool's underlying coinType into
 * `{ kind: "suilend-market", lendingMarket, marketType, reserveArrayIndex, coinType }`
 * for the mobile `SuilendSuiAdapter`.
 *
 * The LendingMarket + MAIN_POOL type are stable, immutable ids (pinned below);
 * the per-asset `reserve_array_index` is read LIVE (Suilend appends reserves, so
 * a static map would rot). Fail closed: no coinType match / unreadable market →
 * `null` → manual deep-link.
 */

import { eqSuiCoinType, getSuiObjectFields } from "./sui-rpc";
import type { DepositTarget, PoolTargetResolver } from "./types";

// Suilend mainnet main market (verified on-chain 2026-07-03). The package rides
// on `marketType` (`<pkg>::suilend::MAIN_POOL`) — the mobile adapter derives the
// moveCall package from it, so it isn't duplicated here.
const LENDING_MARKET =
  "0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1";
const MARKET_TYPE =
  "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::suilend::MAIN_POOL";

/** One reserve slot in `LendingMarket.reserves[]` (only the fields we read). */
interface SuilendReserveField {
  fields?: {
    // Pyth `TypeName` — the underlying coinType WITHOUT a `0x` prefix
    // (e.g. "dba34672…::usdc::USDC").
    coin_type?: { fields?: { name?: string } } | null;
  } | null;
}

/** Underlying coinType (0x-prefixed) at a reserve slot, or undefined. */
function reserveCoinType(r: SuilendReserveField): string | undefined {
  const name = r.fields?.coin_type?.fields?.name;
  return name ? `0x${name}` : undefined;
}

export const SuilendResolver: PoolTargetResolver = {
  family: "suilend",
  aliases: ["suilend"],
  async resolve(pool, _ctx): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "sui") return null;
    const underlying = pool.underlyingTokens?.[0];
    if (!underlying) return null;

    // Read the live reserves vector; the slot index IS `reserve_array_index`.
    const fields = await getSuiObjectFields(LENDING_MARKET);
    const reserves = fields?.reserves as SuilendReserveField[] | undefined;
    if (!Array.isArray(reserves)) return null;

    const reserveArrayIndex = reserves.findIndex((r) =>
      eqSuiCoinType(reserveCoinType(r), underlying),
    );
    if (reserveArrayIndex < 0) return null;

    const coinType = reserveCoinType(reserves[reserveArrayIndex]);
    if (!coinType) return null;

    // The live reserves read IS the on-chain validation (§3.2): the index is
    // only returned when a real reserve's coin_type matches the pool's
    // underlying, so a separate object-type probe would be redundant.
    return {
      kind: "suilend-market",
      lendingMarket: LENDING_MARKET,
      marketType: MARKET_TYPE,
      reserveArrayIndex,
      coinType,
    };
  },
};
