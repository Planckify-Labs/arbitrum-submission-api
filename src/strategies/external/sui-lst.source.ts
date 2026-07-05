/**
 * Sui liquid-staking opportunity source (Phase 3, docs/defi-pool-level-deposits-spec.md).
 *
 * The Sui LST venues (Haedal / Volo / SpringSui / Aftermath) are NOT in
 * DeFiLlama's `/pools` yields feed — DeFiLlama tracks them as *protocols*, but
 * their "stake SUI → LST" is never surfaced as a depositable yield pool. Since
 * the whole opportunity pipeline is `/pools`-driven, without this source those
 * venues would never appear as opportunities and the mobile `SuiLstAdapter`
 * would be dead code.
 *
 * This source SYNTHESIZES one `DeFiLlamaYieldPool`-shaped row per venue and the
 * poll processor appends them to the DeFiLlama list, so they flow through the
 * exact same scoring + caching + target-resolution path as every real pool.
 * `SuiLstResolver` then turns each row back into a `{ kind: "sui-lst" }` target.
 *
 * DATA IS REAL, never guessed (CLAUDE.md):
 *   - APY  = the live Sui network staking APY (stake-weighted `getValidatorsApy`),
 *            the underlying yield every SUI LST delivers.
 *   - TVL  = DeFiLlama's protocol TVL (`/tvl/{slug}`).
 * Both are cached with a last-good fallback so a transient RPC/HTTP hiccup reuses
 * the previous real value instead of fabricating one or dropping the venue.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ValkeyService } from "../../valkey/valkey.service";
import { getSuiNetworkStakingApy } from "../targets/sui-rpc";
import {
  lstPoolId,
  SUI_COIN_TYPE,
  SUI_LST_VENUES,
} from "../targets/sui-lst.config";
import type { DeFiLlamaYieldPool } from "./defillama.client";

const APY_CACHE_KEY = "strategies:lst:apy_pct";
const TVL_CACHE_KEY = (slug: string): string => `strategies:lst:tvl:${slug}`;
// Last-good TTLs generously outlive the 30-min poll so a single failed fetch
// reuses the previous real value rather than dropping the row.
const APY_LASTGOOD_TTL_SEC = 7 * 24 * 60 * 60; // 1 week
const TVL_LASTGOOD_TTL_SEC = 24 * 60 * 60; // 1 day
const REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class SuiLstSource {
  private readonly logger = new Logger(SuiLstSource.name);
  private readonly apiBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly valkeyService: ValkeyService,
  ) {
    this.apiBaseUrl =
      this.configService.get<string>("DEFILLAMA_API_URL") ||
      "https://api.llama.fi";
  }

  /** Synthesized LST opportunity rows (empty on unavailable APY — never faked). */
  async getPools(): Promise<DeFiLlamaYieldPool[]> {
    const apyPct = await this.stakingApyPct();
    if (apyPct == null) {
      this.logger.warn(
        "Sui staking APY unavailable (fresh + last-good both missing) — skipping LST pools this cycle",
      );
      return [];
    }

    const pools: DeFiLlamaYieldPool[] = [];
    for (const v of SUI_LST_VENUES) {
      const tvlUsd = await this.tvlFor(v.defillamaSlug);
      if (tvlUsd == null) {
        this.logger.warn(
          `LST TVL unavailable for ${v.defillamaSlug} — skipping`,
        );
        continue;
      }
      pools.push({
        pool: lstPoolId(v.venue),
        chain: "Sui",
        project: v.defillamaSlug,
        symbol: "SUI",
        tvlUsd,
        apy: apyPct,
        apyBase: apyPct,
        ilRisk: "no",
        exposure: "single",
        poolMeta: v.lstSymbol,
        underlyingTokens: [SUI_COIN_TYPE],
      });
    }

    this.logger.log(
      `Synthesized ${pools.length}/${SUI_LST_VENUES.length} Sui LST pools (staking APY ${apyPct.toFixed(2)}%)`,
    );
    return pools;
  }

  /** Network staking APY as a PERCENT, with last-good fallback. */
  private async stakingApyPct(): Promise<number | null> {
    const fresh = await getSuiNetworkStakingApy();
    if (fresh != null && fresh > 0) {
      const pct = fresh * 100;
      await this.valkeyService
        .set(APY_CACHE_KEY, pct, { ttl: APY_LASTGOOD_TTL_SEC })
        .catch(() => undefined);
      return pct;
    }
    const cached = await this.valkeyService
      .get<number>(APY_CACHE_KEY)
      .catch(() => null);
    return typeof cached === "number" && cached > 0 ? cached : null;
  }

  /** DeFiLlama protocol TVL (USD), with last-good fallback. */
  private async tvlFor(slug: string): Promise<number | null> {
    const fresh = await this.fetchNumber(`${this.apiBaseUrl}/tvl/${slug}`);
    if (fresh != null && fresh > 0) {
      await this.valkeyService
        .set(TVL_CACHE_KEY(slug), fresh, { ttl: TVL_LASTGOOD_TTL_SEC })
        .catch(() => undefined);
      return fresh;
    }
    const cached = await this.valkeyService
      .get<number>(TVL_CACHE_KEY(slug))
      .catch(() => null);
    return typeof cached === "number" && cached > 0 ? cached : null;
  }

  /** GET a bare-number JSON body (DeFiLlama `/tvl/{slug}`); null on any failure. */
  private async fetchNumber(url: string): Promise<number | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const val: unknown = await res.json();
      return typeof val === "number" && Number.isFinite(val) ? val : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
