/**
 * Kamino Lend resolver — turns a DeFiLlama `kamino-lend` pool into a
 * `{ kind: "solana-reserve", program, reserve, mint }` target for the
 * mobile `KaminoLendAdapter` (`services/defi/adapters/kaminoLend.ts` —
 * verification story for the program id / instruction shape lives there).
 *
 * **DeFiLlama's `pool` field is NOT the reserve address.** Kamino's own
 * `yield-server` adaptor (`src/adaptors/kamino-lend/index.js`, read as
 * documentation) emits `pool: r.reserve` — the real on-chain reserve
 * pubkey — but DeFiLlama's PUBLIC `/pools` API re-keys every row under its
 * own synthetic UUID before publishing (confirmed live 2026-08-23: every
 * `kamino-lend` row's `pool` field is a UUID, never a base58 address). So
 * the reserve has to be RECOVERED by joining two of Kamino's own API calls
 * on two keys DeFiLlama's row still carries honestly:
 *
 *   1. `pool.poolMeta` — the lending market's display name (e.g. "Ethena
 *      Market", "SOL/BTC Market") — matched against `name` from
 *      `GET /v2/kamino-market` to find that market's `lendingMarket`
 *      address.
 *   2. `pool.underlyingTokens[0]` — the reserve's liquidity mint — matched
 *      against `liquidityTokenMint` from
 *      `GET /kamino-market/{lendingMarket}/reserves/metrics` to find the
 *      exact `reserve` pubkey within that market.
 *
 * Both matches are EXACT (market name case-insensitive since it is a
 * display label; the mint is a Solana address and compared byte-exact per
 * this codebase's address-case convention — Solana addresses are never
 * folded). A market name miss → `null` → Manual.
 *
 * **A mint can legitimately match MORE THAN ONE reserve in the same
 * market.** Confirmed live 2026-08-23 on "SOL/BTC Market": Kamino carries 3
 * long-abandoned USDC reserves (totalSupplyUsd - totalBorrowUsd ≈ $0.10,
 * $0.10, $97) alongside the one DeFiLlama actually lists (≈$5.3M). Since
 * DeFiLlama's own `tvlUsd` is computed from that exact
 * `totalSupplyUsd - totalBorrowUsd` formula (per the `yield-server` adaptor),
 * recomputing it per candidate and picking the one matching the pool's
 * `tvlUsd` is re-deriving the SAME value DeFiLlama published, not guessing a
 * new one. Still fails closed: the winner must be at least `10×` closer
 * than the runner-up, or the match is genuinely ambiguous and the pool stays
 * Manual (mirrors the Lista curated-vault precedent — see `registry.ts`).
 *
 * No on-chain probe here: the mobile adapter reads and validates the
 * reserve's live state (asset, status, oracle config) itself before
 * building any instruction, mirroring `SolanaLstResolver`'s split of
 * responsibility (resolver picks the address, adapter verifies it live).
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import type {
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";

const KAMINO_API_BASE = "https://api.kamino.finance";
export const KAMINO_LEND_PROGRAM_ID =
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";

interface KaminoMarketRow {
  lendingMarket?: unknown;
  name?: unknown;
}

interface KaminoReserveRow {
  reserve?: unknown;
  liquidityTokenMint?: unknown;
  totalSupplyUsd?: unknown;
  totalBorrowUsd?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

async function loadMarkets(
  ctx: ResolverContext,
): Promise<Array<{ lendingMarket: string; name: string }>> {
  const payload = await ctx.fetchJsonCached<unknown>(
    "defillama:targets:kamino-lend:markets:v1",
    `${KAMINO_API_BASE}/v2/kamino-market`,
    30 * 60,
  );
  if (!Array.isArray(payload)) return [];
  return (payload as KaminoMarketRow[]).flatMap((row) => {
    const lendingMarket = str(row.lendingMarket);
    const name = str(row.name);
    return lendingMarket && name ? [{ lendingMarket, name }] : [];
  });
}

interface ReserveCandidate {
  reserve: string;
  mint: string;
  /** `totalSupplyUsd - totalBorrowUsd` — the SAME formula DeFiLlama's own
   * `yield-server` adaptor uses to compute `tvlUsd` for this exact reserve. */
  tvlUsd: number;
}

async function loadReserves(
  ctx: ResolverContext,
  lendingMarket: string,
): Promise<ReserveCandidate[]> {
  const payload = await ctx.fetchJsonCached<unknown>(
    `defillama:targets:kamino-lend:reserves:${lendingMarket}:v1`,
    `${KAMINO_API_BASE}/kamino-market/${lendingMarket}/reserves/metrics?env=mainnet-beta`,
    30 * 60,
  );
  if (!Array.isArray(payload)) return [];
  return (payload as KaminoReserveRow[]).flatMap((row) => {
    const reserve = str(row.reserve);
    const mint = str(row.liquidityTokenMint);
    if (!reserve || !mint) return [];
    return [
      {
        reserve,
        mint,
        tvlUsd: num(row.totalSupplyUsd) - num(row.totalBorrowUsd),
      },
    ];
  });
}

/**
 * Picks the one reserve DeFiLlama's row actually means when a mint matches
 * more than one reserve in the same market — see the file header. Requires
 * the closest candidate to be at least 10x closer than the runner-up;
 * anything less decisive stays ambiguous (`null`).
 */
function disambiguateByTvl(
  candidates: ReserveCandidate[],
  poolTvlUsd: number,
): ReserveCandidate | null {
  const ranked = [...candidates].sort(
    (a, b) => Math.abs(a.tvlUsd - poolTvlUsd) - Math.abs(b.tvlUsd - poolTvlUsd),
  );
  const [best, runnerUp] = ranked;
  if (!best) return null;
  const bestDistance = Math.abs(best.tvlUsd - poolTvlUsd);
  if (!runnerUp) return best;
  const runnerUpDistance = Math.abs(runnerUp.tvlUsd - poolTvlUsd);
  // bestDistance === 0 with a real runner-up is vanishingly unlikely (would
  // mean two reserves report the identical USD figure) and still safe to
  // accept — no risk of a divide-by-zero false negative here.
  if (bestDistance > 0 && runnerUpDistance / bestDistance < 10) return null;
  return best;
}

export const KaminoLendResolver: PoolTargetResolver = {
  family: "kamino-lend",
  async resolve(
    pool: DeFiLlamaYieldPool,
    ctx: ResolverContext,
  ): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "solana") return null;
    if ((pool.project ?? "").toLowerCase() !== "kamino-lend") return null;
    const marketName = (pool.poolMeta ?? "").trim().toLowerCase();
    const mint = pool.underlyingTokens?.[0];
    if (!marketName || !mint) return null;

    const markets = await loadMarkets(ctx);
    const market = markets.find(
      (m) => m.name.trim().toLowerCase() === marketName,
    );
    if (!market) return null;

    const reserves = await loadReserves(ctx, market.lendingMarket);
    // Exact, case-sensitive: Solana addresses are never folded (unlike
    // EVM/Sui) — see `feedback_address_case_per_encoding`.
    const matches = reserves.filter((r) => r.mint === mint);
    const winner =
      matches.length === 1
        ? matches[0]
        : matches.length > 1
          ? disambiguateByTvl(matches, pool.tvlUsd ?? 0)
          : null;
    if (!winner) return null; // absent, or ambiguously tied → refuse

    return {
      kind: "solana-reserve",
      program: KAMINO_LEND_PROGRAM_ID,
      reserve: winner.reserve,
      mint,
    };
  },
};
