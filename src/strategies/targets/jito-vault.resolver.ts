/**
 * Jito Restaking Vault deposit resolver — turns DeFiLlama's `kyros` pool on
 * Solana into a `{ kind: "jito-vault-deposit", vault, mint }` target for the
 * mobile `JitoVaultDepositAdapter`. Unlike `kamino-kvault` (shared multi-
 * chain `sentora` slug), `kyros` is its own dedicated DeFiLlama project with
 * exactly one Solana pool today, so this is a direct project+chain match
 * with no `poolMeta` table needed — same posture as a single-venue pin.
 *
 * The pinned vault (`CQpvXgoaaawDCLh8FwMZEwQqnPakRUZ5BnzhjnEBPJv`) and its
 * live `supported_mint` (JitoSOL) were verified 2026-08-27 by decoding the
 * real on-chain Vault account — see the mobile adapter's header for the full
 * byte-layout story. No on-chain probe here: fail closed to `null` (stays
 * Manual) on any non-Solana chain or an underlying-token mismatch, so a
 * future re-use of the `kyros` project slug for an unrelated pool can't
 * silently resolve through this pin.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import type { DepositTarget, PoolTargetResolver } from "./types";

const KYROS_VAULT = "CQpvXgoaaawDCLh8FwMZEwQqnPakRUZ5BnzhjnEBPJv";
const JITOSOL_MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";

export const JitoVaultResolver: PoolTargetResolver = {
  family: "jito-vault",
  aliases: ["kyros"],
  async resolve(pool: DeFiLlamaYieldPool): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "solana") return null;
    const underlying = pool.underlyingTokens?.[0];
    if (underlying && underlying !== JITOSOL_MINT) return null;
    return { kind: "jito-vault-deposit", vault: KYROS_VAULT, mint: JITOSOL_MINT };
  },
};
