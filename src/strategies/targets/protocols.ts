/**
 * The protocol catalogue — one entry per protocol (runbook §11.2, §11.5c).
 *
 * **This is the file an engineer adds a protocol to.** Everything a protocol
 * needs is here: how it executes, where its address comes from, which chains it
 * is on, and its tier. Registration, feature-flag gating and the kill-switch
 * are derived from the entry, so a protocol cannot ship half-wired.
 *
 * ## The recipe
 *
 * 1. Find the protocol's own address source. `DefiLlama/yield-server`'s
 *    `src/adaptors/<slug>/index.js` names the endpoint and the field the
 *    address lives in — read it as documentation, not as code to copy (that
 *    repo ships no LICENSE; verified 2026-08-19).
 * 2. Cross-check the endpoint against the protocol's OWN docs. Adding it here
 *    means treating that domain as authoritative for where user funds go.
 * 3. Add one `registerProtocol({...})` below.
 * 4. `pnpm defi:dry-run --protocol <slug>` — resolved counts, and a named
 *    reason for every refusal.
 *
 * ## What you do NOT have to remember
 *
 * The safety layers are not opt-in. A resolver that cannot be confident returns
 * `null` → Manual; `validateTarget` has no `default: true` for EVM kinds, so a
 * kind without a validator is rejected rather than trusted; the deposit-time
 * pipeline runs regardless. The worst outcome of a wrong entry here is a pool
 * that stays Manual, never funds sent somewhere they should not go.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import {
  addr,
  asArray,
  protocolApiSource,
  rec,
  str,
} from "./candidates/protocol-api.source";
import type { CandidateSource } from "./candidates/registry";
import { poolUrlCandidate } from "./defillama-pool-address";
import { registerProtocol } from "./protocol-manifest";
import type { Address, ResolverContext } from "./types";
import { eqAddr, resolveEvmChainId } from "./types";

/**
 * Balancer's API keys chains by its own enum rather than by chainId. Only the
 * chains our v2 book covers are listed — an absent chain declines rather than
 * asking about a deployment we could not execute against anyway.
 */
const BALANCER_API_CHAINS: Readonly<Record<number, string>> = {
  1: "MAINNET",
  10: "OPTIMISM",
  100: "GNOSIS",
  137: "POLYGON",
  8453: "BASE",
  42161: "ARBITRUM",
  43114: "AVALANCHE",
};

// ── ERC-4626 vaults discovered from the protocol's own API ─────────────────

registerProtocol({
  slug: "yo-protocol",
  aliases: ["yo-protocol", "yo", "yo-finance"],
  tier: "tier1",
  execution: { kind: "erc4626" },
  minTvlUsd: 250_000,
  discovery: {
    via: "protocol-api",
    url: () => "https://api.yo.xyz/api/v1/vault/stats?secondary=true",
    rows(payload, chainId) {
      return asArray(rec(payload).data).flatMap((raw) => {
        const v = rec(raw);
        if (Number(rec(v.chain).id) !== chainId) return [];
        const address = addr(rec(v.contracts).vaultAddress);
        const asset = addr(rec(v.asset).address);
        if (!address || !asset) return [];
        return [{ address, asset, symbol: str(v.id), name: str(v.name) }];
      });
    },
  },
});

registerProtocol({
  slug: "ipor-fusion",
  aliases: ["fusion-by-ipor", "ipor-fusion", "ipor"],
  tier: "tier1",
  execution: { kind: "erc4626" },
  minTvlUsd: 250_000,
  discovery: {
    via: "protocol-api",
    // 415 vaults across every chain, so the per-chain filter matters before
    // anything is matched. Response is gzipped.
    url: () => "https://api.ipor.io/fusion/vaults",
    rows(payload, chainId) {
      return asArray(rec(payload).vaults).flatMap((raw) => {
        const v = rec(raw);
        if (Number(v.chainId) !== chainId) return [];
        const address = addr(v.address);
        const asset = addr(v.assetAddress);
        if (!address || !asset) return [];
        return [{ address, asset, symbol: str(v.asset), name: str(v.name) }];
      });
    },
  },
});

registerProtocol({
  slug: "vesper",
  aliases: ["vesper", "vesper-finance"],
  tier: "tier1",
  execution: { kind: "erc4626" },
  minTvlUsd: 250_000,
  // VERIFIED NOT ERC-4626, on chain, 2026-08-21. `vamsETH`
  // (0xCa7c607C590ad16007CCBbba9D26f4df656a36C2) and `vaUSDC`
  // (0xa8b607Aa09B6A2E306F93e74c282Fb13f6A80452) both REVERT on `asset()`,
  // `totalAssets()`, `maxDeposit()` and `convertToShares()`, and answer
  // `token()` instead. Vesper's VPool is the older `deposit(uint256)` /
  // `withdraw(uint256)` shape, which the 4626 adapter cannot build for.
  //
  // Discovery was never the problem: the source found the right vault for 4 of
  // 7 pools and `validateErc4626` refused every one, exactly as designed. The
  // entry stays here rather than being deleted so the next person does not
  // re-derive this — unlocking Vesper needs a `vault-v2` execution kind
  // (adapter + validator + Layer-4 decode + Layer-5 pause), not a fix here.
  withheld:
    "VPool is not ERC-4626: asset()/totalAssets()/convertToShares() all revert " +
    "on chain (verified 2026-08-21); needs a `vault-v2` execution kind",
  discovery: {
    via: "protocol-api",
    // One HOST per chain rather than a chainId field, so the endpoint itself
    // carries the chain and every row is in scope.
    url(chainId) {
      const host: Record<number, string> = {
        1: "https://api.vesper.finance",
        8453: "https://api-base.vesper.finance",
        10: "https://api-optimism.vesper.finance",
      };
      return host[chainId] ? `${host[chainId]}/pools?stages=prod` : null;
    },
    rows(payload) {
      return asArray(payload).flatMap((raw) => {
        const v = rec(raw);
        const address = addr(v.address);
        const asset = addr(rec(v.asset).address);
        if (!address || !asset) return [];
        return [{ address, asset, symbol: str(v.name), name: str(v.poolName) }];
      });
    },
  },
});

/**
 * Fluid Lite — a separate product from the `fToken` lending markets, and it was
 * `reserved` only because nobody had checked it. Checked now.
 *
 * The USD vault (`fLiteUSD`, 0x273DA948…) is a genuine ERC-4626 over USDC:
 * `asset()`, `totalAssets()`, `convertToShares()` all answer and `maxDeposit`
 * is unbounded (verified on chain 2026-08-21). Endpoint from
 * `yield-server/src/adaptors/fluid-lite/index.js`.
 *
 * **The ETH vault is deliberately not reachable here, and it is the bigger one
 * (~$170M).** `iETHv2` (0xA0D3707c…) is real 4626, but its `asset()` is
 * **stETH**, while DeFiLlama publishes that pool's underlying as the native
 * sentinel normalised to the zero address. So the pool row and the contract
 * disagree about what is being deposited. `matchVault` filters on the asset and
 * finds nothing, `validateErc4626` would refuse the pairing anyway, and the
 * pool stays Manual — which is the right answer: a user sending ETH would need
 * Fluid's `ethWrapperContract`, a different call shape from `deposit(assets,
 * receiver)`, and that is a new execution kind rather than a discovery fix.
 *
 * Fetching only the USD endpoint keeps that honest: adding the ETH endpoint
 * would put a candidate in the set that can never legitimately match.
 */
registerProtocol({
  slug: "fluid-lite",
  aliases: ["fluid-lite"],
  tier: "tier1",
  execution: { kind: "erc4626" },
  minTvlUsd: 250_000,
  discovery: {
    via: "protocol-api-addresses",
    url: (chainId) =>
      chainId === 1
        ? "https://api.fluid-lite.instadapp.ai/lite-usd/vault"
        : null,
    addresses(payload) {
      const address = addr(rec(rec(payload).data).address);
      return address ? [address] : [];
    },
  },
});

/**
 * Curve's API keys chains by its own slug rather than by chainId. Only chains
 * we can execute on are listed; an absent chain declines.
 */
const CURVE_CHAINS: Readonly<Record<number, string>> = {
  1: "ethereum",
  10: "optimism",
  137: "polygon",
  8453: "base",
  42161: "arbitrum",
};

// ── Discovery only: the resolver is registered elsewhere ──────────────────

/**
 * Curve LlamaLend discovery.
 *
 * Label matching alone tops out early here: DeFiLlama emits `poolMeta` as
 * "<collateral> collateral", and that is **not unique** — Ethereum has two
 * separate crvUSD markets both labelled "sfrxUSD collateral". Ambiguity is a
 * refusal, so 8 of 11 lend rows stayed Manual for a reason no amount of fuzzy
 * matching could fix.
 *
 * There is an exact key available, though, and it comes from the two sources
 * AGREEING rather than from trusting either: DeFiLlama's deep link for a lend
 * row points at the market's **Controller**, and Curve's own API publishes
 * `controllerAddress` alongside the vault. Joining on it identifies the vault
 * exactly, and the address that is actually returned is always Curve's
 * `address` field — the deep link only ever selects, it never supplies the
 * deposit target. A tampered link can at worst pick the wrong Curve vault,
 * which `validateErc4626` then has to accept as a real vault for the pool's own
 * asset, and Layer-1 still runs on top of that.
 *
 * Label matching stays as the fallback for rows whose link has no controller.
 */
function curveLlamaLendSource(): CandidateSource {
  const byLabel = protocolApiSource({
    family: "curve-llamalend",
    projects: ["curve-llamalend", "llamalend"],
    url: (chainId) =>
      CURVE_CHAINS[chainId]
        ? "https://api.curve.finance/v1/getLendingVaults/all"
        : null,
    rows: (payload, chainId) => curveVaults(payload, chainId),
  });

  return {
    id: byLabel.id,
    projects: byLabel.projects,
    async candidate(
      pool: DeFiLlamaYieldPool,
      ctx: ResolverContext,
    ): Promise<Address | null> {
      const chainId = resolveEvmChainId(pool.chain);
      if (!chainId || !CURVE_CHAINS[chainId]) return null;

      const controller = await poolUrlCandidate(pool, ctx);
      if (controller) {
        const payload = await ctx.fetchJsonCached<unknown>(
          `defillama:targets:protocol-api:curve-llamalend:${chainId}:v1`,
          "https://api.curve.finance/v1/getLendingVaults/all",
          30 * 60,
        );
        const hit = curveVaults(payload, chainId).find((v) =>
          eqAddr(v.controller, controller),
        );
        if (hit) return hit.address;
      }
      return byLabel.candidate(pool, ctx);
    },
  };
}

interface CurveLendVault {
  address: Address;
  asset: Address;
  controller: Address | null;
  symbol: string | null;
  name: string | null;
}

function curveVaults(payload: unknown, chainId: number): CurveLendVault[] {
  const chain = CURVE_CHAINS[chainId];
  if (!chain) return [];
  const data = rec(rec(payload).data);
  return asArray(data.lendingVaultData).flatMap((raw) => {
    const v = rec(raw);
    if (str(v.blockchainId) !== chain) return [];
    const address = addr(v.address);
    const assets = rec(v.assets);
    const borrowed = rec(assets.borrowed);
    const asset = addr(borrowed.address);
    if (!address || !asset) return [];
    const collateral = str(rec(assets.collateral).symbol);
    return [
      {
        address,
        asset,
        controller: addr(v.controllerAddress),
        symbol: str(borrowed.symbol),
        // Mirrors the `poolMeta` DeFiLlama builds for the lend side, so the
        // fallback has something to match on.
        name: collateral ? `${collateral} collateral` : str(v.name),
      },
    ];
  });
}

/**
 * Curve LlamaLend — 21 pools that resolved nothing.
 *
 * `CurveLlamaLendResolver` had no working discovery: the Curve MetaRegistry
 * source only knows LP pools, and the generic deep-link fallback answers with
 * the address in `lendingVaultUrls.deposit` — which is the **Controller**, not
 * the vault (`0x1E0165DbD…` vs vault `0x8cf1DE26…` for the same market). Every
 * one of those 20 candidates reverted on `asset()` and was refused, correctly.
 *
 * Curve's own API publishes both, and `lendingVaultData[].address` is the
 * ERC-4626 vault. Endpoint from
 * `yield-server/src/adaptors/curve-llamalend/index.js`.
 *
 * Labels matter here because a single asset backs many markets — crvUSD is the
 * borrowed asset in 52 Ethereum vaults — so `name` is built as
 * "<collateral> collateral" to line up with the `poolMeta` DeFiLlama emits for
 * the lend side. Anything ambiguous is refused rather than guessed, and the
 * borrow side never reaches here (see `skipPool` on the resolver).
 */
registerProtocol({
  slug: "curve-llamalend",
  aliases: ["curve-llamalend", "llamalend"],
  tier: "tier1",
  execution: {
    kind: "bespoke",
    // `CurveLlamaLendResolver`, in that file.
    resolvedBy: "erc4626-family.resolver.ts",
  },
  discovery: { via: "source", source: curveLlamaLendSource() },
});

/**
 * Concrete — $1.06B across 15 pools, and the largest single-asset protocol in
 * the onboarding queue.
 *
 * `ConcreteResolver` (erc4626-family.resolver.ts) has always been registered
 * and has always resolved nothing, because its only discovery path was
 * `/poolsOld`. Concrete's DeFiLlama `url` is the bare `app.concrete.xyz/` with
 * no address in it, so the generic deep-link source cannot help either. The
 * protocol's own API is the only route.
 *
 * Endpoint and payload shape are transcribed from
 * `DefiLlama/yield-server/src/adaptors/concrete/index.js` (read as
 * documentation — that repo ships no LICENSE): `data[chainId]` is an object
 * whose VALUES are vaults carrying `address` and `name`, and the adaptor
 * multicalls `asset()` itself rather than reading it from the response, which
 * is why this is a `protocol-api-addresses` entry.
 *
 * **Not yet observed answering.** `apy.api.concrete.xyz` returned HTTP 503 on
 * every path throughout 2026-08-21 ("failure to get a peer from the
 * ring-balancer" — an upstream outage on their side, not a wrong URL). Shipping
 * it anyway is safe and is the faster path to knowing: a wrong shape yields
 * zero addresses, which logs a named warning and reports the source DARK, and
 * every pool stays Manual either way. Verify with
 * `pnpm defi:dry-run --protocol concrete` once the API is back.
 */
registerProtocol({
  slug: "concrete",
  aliases: ["concrete", "concrete-earn"],
  tier: "tier1",
  execution: {
    kind: "bespoke",
    // `ConcreteResolver`, in that file. The conformance spec requires a bare
    // filename here, so the resolver's own name lives in the doc block above.
    resolvedBy: "erc4626-family.resolver.ts",
  },
  discovery: {
    via: "protocol-api-addresses",
    // One call serves every chain; the payload is keyed by chain id.
    url: () => "https://apy.api.concrete.xyz/v1/vault:tvl/all",
    addresses(payload, chainId) {
      const forChain = rec(rec(payload)[String(chainId)]);
      return Object.values(forChain).flatMap((raw) => {
        const v = rec(raw);
        // The adaptor drops these before publishing, so a pool row can never
        // refer to one. Keeping them would only add ambiguity to `matchVault`.
        if (/test|pre-deposit/i.test(str(v.name) ?? "")) return [];
        const address = addr(v.address);
        return address ? [address] : [];
      });
    },
  },
});

// ── Discovery only: identity is bespoke, resolver lives elsewhere ──────────

registerProtocol({
  slug: "pendle",
  aliases: ["pendle", "pendle-lp", "pendle-pt", "pendle-yt"],
  tier: "tier3",
  execution: { kind: "bespoke", resolvedBy: "router-call.resolver.ts" },
  discovery: {
    via: "protocol-api",
    // limit is CAPPED AT 100 by the API — a larger value returns HTTP 400, and
    // the resulting error object has no `results`, so the source silently
    // yielded nothing. It read exactly like "Pendle has no pools of ours" until
    // the discovery-health check reported it DARK (0 hits / 72 lookups).
    url: (chainId) =>
      `https://api-v2.pendle.finance/core/v1/${chainId}/markets?limit=100`,
    rows(payload) {
      const now = Date.now();
      return asArray(rec(payload).results).flatMap((raw) => {
        const v = rec(raw);
        // EXPIRED MARKETS ARE DROPPED. A matured Pendle market does not revert
        // on deposit — it quietly accepts funds into something nobody is
        // maintaining, which §11 Layer 5 calls out by name.
        if (v.isActive === false) return [];
        const expiry = str(v.expiry);
        if (expiry && Date.parse(expiry) <= now) return [];
        const address = addr(v.address);
        if (!address) return [];
        // DeFiLlama lists a Pendle pool's `underlyingTokens` as the market's SY
        // and PT, not its economic underlying, so matching on `underlyingAsset`
        // alone found nothing (source went DARK: 0 hits / 72 lookups). Fan out
        // every address this market is known by and let `matchVault` filter.
        //
        // Safe because the asset here is only a MATCHING KEY: the routed
        // address is always `v.address`, the market itself. A wider key set can
        // change WHICH market matches, never where funds go, and the label rule
        // plus Layer-1 validation still gate that.
        const keys = [
          rec(v.underlyingAsset).address,
          rec(v.accountingAsset).address,
          rec(v.sy).address,
          rec(v.pt).address,
          rec(v.lp).address,
        ];
        const seen = new Set<string>();
        return keys.flatMap((k) => {
          const asset = addr(k);
          if (!asset || seen.has(asset)) return [];
          seen.add(asset);
          return [
            { address, asset, symbol: str(v.proName), name: str(v.symbol) },
          ];
        });
      });
    },
  },
});

registerProtocol({
  slug: "balancer",
  aliases: [
    "balancer-v2",
    "balancer-v3",
    "balancer",
    "beethoven-x",
    "beets",
    "beets-dex",
  ],
  tier: "tier3",
  execution: { kind: "bespoke", resolvedBy: "balancer.resolver.ts" },
  discovery: {
    via: "protocol-api",
    url: (chainId) =>
      BALANCER_API_CHAINS[chainId]
        ? "https://api-v3.balancer.fi/graphql"
        : null,
    init: (chainId) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `{ poolGetPools(first: 1000, where: { chainIn: [${BALANCER_API_CHAINS[chainId]}] }) { address name symbol poolTokens { address } } }`,
      }),
    }),
    rows(payload) {
      // One row PER POOL TOKEN, sharing the pool address: a Balancer pool holds
      // several assets and `matchVault` filters by the single asset DeFiLlama
      // says the pool deposits, so fanning the tokens out lets the existing
      // matcher work unchanged. v2 vs v3 is decided by the resolver's own
      // `getPoolId()` probe, not here.
      return asArray(rec(rec(rec(payload).data).poolGetPools)).flatMap(
        (raw) => {
          const v = rec(raw);
          const address = addr(v.address);
          if (!address) return [];
          return asArray(v.poolTokens).flatMap((t) => {
            const asset = addr(rec(t).address);
            if (!asset) return [];
            return [
              { address, asset, symbol: str(v.symbol), name: str(v.name) },
            ];
          });
        },
      );
    },
  },
});

/**
 * Compound's OWN v2 markets — the family Venus, Benqi and Moonwell were forked
 * from, and the last one still Manual.
 *
 * It was `reserved` because its Comptroller was not pinned and the slug was
 * being answered by the compound-v3 resolver on substring. Both are fixed: the
 * Comptroller is in the address book (verified on chain), and this exact claim
 * beats any substring one.
 *
 * No new adapter, validator or kind — `compound-v2` has shipped since Tier 2
 * and three forks already run on it. Discovery is the shared Comptroller
 * source, which enumerates `getAllMarkets()` and reads each cToken's
 * `underlying()` on chain.
 *
 * Expect PARTIAL coverage, correctly: `cETH` holds native ETH and its
 * `underlying()` reverts, so `describeVaults` drops it and the WETH pool stays
 * Manual. A native-coin mint is `mint()` payable, a different call shape from
 * `mint(uint256)`, and guessing it is not on the table (§12 Q5).
 */
registerProtocol({
  slug: "compound-v2",
  aliases: ["compound-v2"],
  tier: "tier2",
  execution: { kind: "compound-v2" },
  minTvlUsd: 250_000,
  discovery: { via: "registered-source", sourceId: "compound-v2-comptroller" },
});

// ── Reserved slugs: claimed so a look-alike cannot take them ──────────────

registerProtocol({
  slug: "aave-v4",
  aliases: ["aave-v4", "aave-v4-core"],
  tier: "tier1",
  execution: {
    kind: "reserved",
    reason:
      "Aave v4 is a different interface (spec §1.5: 'defer'). Without this " +
      "claim the registry's substring fallback sent v4 pools to the v3 Pool, " +
      "which VALIDATED — wstETH/WBTC/weETH are real v3 reserves — so users " +
      "would have been shown v4 and deposited into v3. Verified 2026-08-21.",
  },
});

/**
 * Slugs a look-alike family was already answering for, found by the dry run's
 * substring report on 2026-08-21. None of them resolved — Layer-1 validation
 * refused every one — but relying on that is relying on luck: `aave-v4` DID
 * validate, because wstETH and WBTC are genuinely listed Aave v3 reserves.
 *
 * Each of these is a DIFFERENT product from the family that was answering for
 * it. Reserving the slug makes that explicit instead of leaving it to a
 * validator to notice.
 */
for (const [slug, aliases, reason] of [
  [
    "sparkdex",
    ["sparkdex", "sparkdex-v3.1", "sparkdex-v4"],
    "SparkDEX is an AMM on Flare and has nothing to do with SparkLend, the " +
      "Aave-v3 fork. The slug contains 'spark', so SparkLend was answering for it.",
  ],
  [
    "fluid-dex",
    ["fluid-dex", "fluid-dex-lite"],
    "Fluid DEX is an AMM, not the fToken lending market the `fluid` family " +
      "resolves. Largest slug in the Manual queue (~$16.8B), so a wrong match " +
      "here would be the most expensive one available.",
  ],
  [
    "velodrome-v3",
    ["velodrome-v3"],
    "A different generation from the Solidly-fork v2 the `velodrome` family " +
      "implements; its pools are concentrated-liquidity.",
  ],
  [
    "beets-dex-v3",
    ["beets-dex-v3"],
    "Balancer-v3-shaped, while the `beets` family resolves v2 join/exit. The " +
      "mobile adapter refuses a non-v2 Vault anyway, so this only ever fails " +
      "later and less clearly.",
  ],
  [
    "origin-arm",
    ["origin-arm"],
    "Origin's ARM is a different product from the wrapped 4626 receipts in " +
      "`ORIGIN_VAULTS`.",
  ],
  [
    "venus-flux",
    ["venus-flux"],
    "Flux is a separate deployment answered by both `venus` and `venus-4626`. " +
      "Unreviewed: it may well be a supportable fork, but nobody has checked.",
  ],
] as const) {
  registerProtocol({
    slug,
    aliases,
    tier: "tier1",
    execution: { kind: "reserved", reason },
  });
}

// ── Declared but WITHHELD ──────────────────────────────────────────────────
// Kept as entries rather than omissions so the gap is readable in code. Each
// needs an address source before it can resolve anything (§11.5b).

for (const [slug, aliases, why] of [
  [
    "maple",
    ["maple", "syrup", "maple-finance"],
    // Addresses are no longer the blocker — Spark's own registry pins
    // syrupUSDC 0x80ac24aA929eaF5013f6436cdA2a7ba190f5Cc0b and syrupUSDT
    // 0x356B8d89c1e1239Cbbb9dE4815c39A1474d5BA7D, and BOTH are genuine
    // ERC-4626 (asset/totalAssets/convertToShares all answer, verified
    // 2026-08-21). They are still unusable: `maxDeposit` returns 0 for a
    // non-allowlisted receiver, because Syrup pools are permissioned. A user
    // deposit would revert. This is the case that put a maxDeposit gate into
    // validateErc4626 — so even if a candidate source finds these, they fail
    // closed rather than badging in-app.
    "syrupUSDC/USDT are real 4626 vaults but permissioned: maxDeposit == 0 for an ordinary receiver (verified on chain 2026-08-21), so a deposit would revert",
  ],
  [
    "etherfi-liquid",
    ["ether.fi-liquid", "etherfi-liquid"],
    "liquidETH is a BoringVault, not ERC-4626 — `asset()` reverts on chain (verified 2026-08-19)",
  ],
  [
    "avant",
    ["avant-avbtc", "avant-avusd", "avant"],
    "no public vault-list endpoint found",
  ],
  [
    "forty-acres",
    ["40-acres", "forty-acres"],
    "no public vault-list endpoint found",
  ],
  [
    "autofinance",
    ["autofinance", "auto-finance"],
    "vaults come from tokemaklabs' autopools API; endpoint not yet reviewed",
  ],
] as const) {
  registerProtocol({
    slug,
    aliases,
    tier: "tier1",
    execution: { kind: "erc4626" },
    minTvlUsd: 250_000,
    withheld: why,
  });
}
