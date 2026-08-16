/**
 * Morpho Blue oracle / IRM allowlist (spec §11 Layer-1, §12 Q6).
 *
 * **Why a lender needs this.** Supplying to an isolated market looks like a
 * pure lending position, but you inherit the market's bad-debt risk: if the
 * oracle can be manipulated, borrowers escape liquidation and the loss lands on
 * suppliers. A market's `oracle` and `irm` are therefore part of its identity,
 * not incidental config, and a market whose oracle we have not vetted is one we
 * do not route funds into.
 *
 * **How the list is built.** Seeded from Morpho's own curation signal (their
 * API exposes whitelisted/curated markets), then PINNED here so a silent change
 * on their side cannot widen our exposure without a reviewed diff. Trust their
 * curation, verify it stays what we reviewed.
 *
 * Empty entry for a chain ⇒ no Morpho Blue market on that chain resolves ⇒
 * Manual. Fail closed (§8.2).
 */

import type { Address } from "./types";
import { eqAddr } from "./types";

interface MorphoRiskAllowlist {
  /** Oracle contracts we accept on this chain. */
  readonly oracles: readonly Address[];
  /** Interest-rate models we accept on this chain. */
  readonly irms: readonly Address[];
}

/**
 * Morpho's canonical AdaptiveCurveIRM is the only IRM used by curated markets
 * on both live deployments; oracles are per-market (Chainlink-backed
 * `MorphoChainlinkOracleV2` instances), so the oracle list is seeded per market
 * and reviewed on change.
 */
const ALLOWLIST: Readonly<Record<number, MorphoRiskAllowlist>> = {
  1: {
    irms: ["0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC"], // AdaptiveCurveIRM
    oracles: [],
  },
  8453: {
    irms: ["0x46415998764C29aB2a25CbeA6254146D50D22687"], // AdaptiveCurveIRM (Base)
    oracles: [],
  },
};

/**
 * True when BOTH the market's oracle and IRM are on the reviewed list for this
 * chain. An empty `oracles` list means "no market reviewed yet" and rejects
 * everything — populating it is a deliberate, reviewed act (§12 Q6).
 */
export function isMorphoRiskAllowlisted(
  chainId: number,
  oracle: string | undefined,
  irm: string | undefined,
): boolean {
  const entry = ALLOWLIST[chainId];
  if (!entry) return false;
  const irmOk = entry.irms.some((a) => eqAddr(a, irm));
  const oracleOk = entry.oracles.some((a) => eqAddr(a, oracle));
  return irmOk && oracleOk;
}

/** Diagnostics for the boot log / tests — never used for matching. */
export function morphoAllowlistSize(chainId: number): {
  oracles: number;
  irms: number;
} {
  const entry = ALLOWLIST[chainId];
  return { oracles: entry?.oracles.length ?? 0, irms: entry?.irms.length ?? 0 };
}
