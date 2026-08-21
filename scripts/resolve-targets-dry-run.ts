/**
 * resolve-targets-dry-run.ts
 *
 * Answers "what would actually resolve if we turned this on?" without turning
 * it on. Runs the real resolver registry against the real DeFiLlama feed and
 * real chain state, and prints, per pool, whether it would badge "Deposit
 * in-app" or fall back to the Manual deep link — and when it refuses, why.
 *
 * This is READ-ONLY in the strong sense: resolvers and validators only ever
 * `eth_call`. Nothing is signed, nothing is broadcast, no funds move, and no DB
 * row is written. Safe to point at mainnet.
 *
 * It exists because the tier flags default OFF (spec §11.3), which means the
 * expansion cannot be observed by just running the app. This is how you observe
 * it, and it is also how the pinned address book gets audited by reality: a
 * wrong Comet fails `baseToken()`, a wrong Pool fails the reserve lookup, and
 * both show up here as a refusal instead of silently degrading in production.
 *
 * Usage:
 *   pnpm defi:dry-run                       # all families, all chains
 *   pnpm defi:dry-run --protocol aave-v3    # one DeFiLlama project slug
 *   pnpm defi:dry-run --chain Base          # one chain, by catalog name
 *   pnpm defi:dry-run --limit 50 --verbose
 *   pnpm defi:dry-run --respect-flags       # use the real env flags
 *
 * Env:
 *   DATABASE_URL                  required — the chain directory is DB-backed.
 *   RPC_PROXY_URL / RPC_PROXY_API_KEY   how `Blockchain.rpcUrl` routes resolve.
 *   STRATEGIES_RPC_URL_<chainId>  per-chain override (point at anvil for a fork run).
 *
 * By default every tier flag is forced ON for the duration of this process, so
 * the dry run shows the full picture regardless of what production has enabled.
 * `--respect-flags` disables that.
 *
 * Exit codes:
 *   0 — the run completed (refusals are data, not failure)
 *   1 — could not run at all (no DB, no chains, no pools)
 */

// Outbound-network defaults. MUST be the first import: the discovery
// endpoints are dual-stack, and without this a perfectly healthy protocol
// reports zero pools and reads as "not ours". This script does NOT boot
// through `src/main.ts`, so it has to import the preamble itself.
import "../src/config/egress-network";

// `@generated/prisma`, not `@prisma/client` — the schema generates the client
// into src/generated/prisma (see prisma/schema.prisma). Prisma 7 requires the
// driver adapter to be passed explicitly, the same way PrismaService does.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { candidateSourceHealth } from "../src/strategies/targets/candidates/registry";
import { substringMatchReport } from "../src/strategies/targets/registry";

interface Options {
  /** DeFiLlama project slug. NOT --project: ts-node claims that flag. */
  protocol?: string;
  chain?: string;
  limit: number;
  minTvlUsd: number;
  verbose: boolean;
  /** Print the onboarding queue: what is Manual, biggest TVL first. */
  queue: boolean;
  respectFlags: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    limit: Number.POSITIVE_INFINITY,
    minTvlUsd: 1_000_000,
    verbose: false,
    queue: false,
    respectFlags: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--protocol") opts.protocol = next()?.toLowerCase();
    else if (arg === "--chain") opts.chain = next()?.toLowerCase();
    else if (arg === "--limit") opts.limit = Number(next());
    else if (arg === "--min-tvl") opts.minTvlUsd = Number(next());
    else if (arg === "--verbose" || arg === "-v") opts.verbose = true;
    else if (arg === "--queue") opts.queue = true;
    else if (arg === "--respect-flags") opts.respectFlags = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: pnpm defi:dry-run [--protocol <slug>] [--chain <name>] [--limit N] [--min-tvl N] [--respect-flags] [--verbose] [--queue]",
      );
      process.exit(0);
    }
  }
  return opts;
}

const options = parseArgs(process.argv);

// Force the tier flags ON *before* importing anything that reads them —
// `bootTargetResolvers` consults them at registration time. Without this the
// dry run would faithfully reproduce production's "nothing is registered",
// which is exactly the thing it exists to see past.
if (!options.respectFlags) {
  process.env.FEATURE_DEFI_EVM_TIER1 = "true";
  process.env.FEATURE_DEFI_EVM_TIER2 = "true";
  process.env.FEATURE_DEFI_EVM_TIER3 = "true";
  // Tier 4 stays off: §7 withholds the async-vault resolver entirely, so
  // forcing the flag would register nothing anyway and imply otherwise.
}

/**
 * Loaded with a dynamic import, deliberately AFTER the env writes above:
 * `bootTargetResolvers` reads the tier flags at registration time, so a static
 * import at the top of the file would evaluate the module graph first and the
 * forced flags would arrive too late to matter.
 */
async function loadResolverModules() {
  const [bootstrap, chainDirectory, registry, rpc, validation] =
    await Promise.all([
      import("../src/strategies/targets/bootstrap"),
      import("../src/strategies/targets/chain-directory"),
      import("../src/strategies/targets/registry"),
      import("../src/strategies/targets/rpc"),
      import("../src/strategies/targets/validation"),
    ]);
  return {
    ...bootstrap,
    ...chainDirectory,
    ...registry,
    ...rpc,
    ...validation,
  };
}

type ResolverModules = Awaited<ReturnType<typeof loadResolverModules>>;

const POOLS_URL = "https://yields.llama.fi/pools";

interface Pool {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number | null;
  ilRisk: "yes" | "no";
  exposure: "multi" | "stable" | "single";
  poolMeta?: string | null;
  underlyingTokens?: string[] | null;
}

type Outcome =
  | { status: "resolved"; kind: string; destination: string }
  | { status: "refused" }
  | { status: "no-resolver" }
  | { status: "chain-unreachable" }
  | { status: "testnet-misroute"; chainId: number }
  | { status: "error"; detail: string };

/** The address a target would actually send funds to, for eyeballing. */
function destinationOf(target: Record<string, unknown>): string {
  for (const field of [
    "vault",
    "pool",
    "comet",
    "cToken",
    "market",
    "router",
    "receipt",
    "entry",
  ]) {
    const value = target[field];
    if (typeof value === "string" && value.startsWith("0x")) return value;
  }
  return "(kind-specific)";
}

/** Minimal in-process cache so repeated protocol-API hits don't re-fetch. */
function makeContext(mod: ResolverModules) {
  const cache = new Map<string, unknown>();
  return {
    async fetchJsonCached<T>(
      cacheKey: string,
      url: string,
      _ttlSec: number,
      init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      },
    ): Promise<T | null> {
      if (cache.has(cacheKey)) return cache.get(cacheKey) as T;
      try {
        const res = await fetch(url, {
          method: init?.method ?? "GET",
          headers: init?.headers ?? { Accept: "application/json" },
          body: init?.body,
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as T;
        cache.set(cacheKey, json);
        return json;
      } catch {
        return null;
      }
    },
    validate: (target: never, pool: never) => mod.validateTarget(target, pool),
    publicClient: (chainId: number) => mod.getPublicClientForChain(chainId),
  };
}

async function loadChains(
  prisma: PrismaClient,
  mod: ResolverModules,
): Promise<number> {
  const rows = await prisma.blockchain.findMany({
    where: { isActive: true },
    select: {
      chainId: true,
      name: true,
      chainSlug: true,
      rpcUrl: true,
      type: true,
      isTestnet: true,
    },
    orderBy: [{ isTestnet: "asc" }, { name: "asc" }],
  });
  mod.loadChainDirectory(
    rows.map((r) => ({
      chainId: r.chainId,
      name: r.name,
      chainSlug: r.chainSlug,
      rpcUrl: r.rpcUrl,
      family: r.type,
      isTestnet: r.isTestnet,
    })),
  );
  mod.resetRpcClients();
  return rows.length;
}

/**
 * Prove each EVM chain is actually reachable before resolving against it.
 * Without this, a dead RPC looks identical to "the validator refused" — and
 * those two need completely different responses from whoever is reading the
 * output.
 */
async function checkReachability(mod: ResolverModules): Promise<Set<number>> {
  const reachable = new Set<number>();
  const rows = mod
    .listChainDirectory()
    .filter(
      (r) => r.family === "EVM" && typeof r.chainId === "number",
    ) as Array<{
    name: string;
    chainId: number;
  }>;
  console.log("Chain reachability");
  for (const row of rows) {
    const client = mod.getPublicClientForChain(row.chainId);
    if (!client) {
      console.log(`  ✗ ${row.name} (${row.chainId}) — no usable RPC endpoint`);
      continue;
    }
    try {
      const id = await client.getChainId();
      if (id !== row.chainId) {
        console.log(
          `  ✗ ${row.name} (${row.chainId}) — endpoint reports chainId ${id}`,
        );
        continue;
      }
      reachable.add(row.chainId);
      console.log(`  ✓ ${row.name} (${row.chainId})`);
    } catch (err) {
      console.log(
        `  ✗ ${row.name} (${row.chainId}) — ${(err as Error)?.message?.split("\n")[0] ?? "unreachable"}`,
      );
    }
  }
  console.log("");
  return reachable;
}

async function fetchPools(): Promise<Pool[]> {
  const res = await fetch(POOLS_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`DeFiLlama /pools returned HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Pool[] };
  return body.data ?? [];
}

function pad(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, width - 1)}…`
    : value.padEnd(width);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "DATABASE_URL is not set. The chain directory is DB-backed (chains are data, not constants), so there is nothing to resolve against without it.",
    );
    process.exit(1);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  const mod = await loadResolverModules();
  try {
    const chainCount = await loadChains(prisma, mod);
    if (chainCount === 0) {
      console.error(
        "No active Blockchain rows. Chains are data-driven, so with an empty directory every pool resolves to Manual by design.",
      );
      process.exit(1);
    }
    console.log(`Loaded ${chainCount} chain rows from the database.\n`);

    mod.bootTargetResolvers();
    const reachable = await checkReachability(mod);

    const all = await fetchPools();
    const pools = all
      .filter((p) => p.tvlUsd >= options.minTvlUsd)
      .filter(
        (p) =>
          !options.protocol || p.project.toLowerCase() === options.protocol,
      )
      .filter((p) => !options.chain || p.chain.toLowerCase() === options.chain)
      // Only pools some resolver actually claims — the rest are Manual by
      // definition and would drown the signal.
      .filter((p) => mod.getResolversForProject(p.project).length > 0)
      .sort((a, b) => b.tvlUsd - a.tvlUsd)
      .slice(0, options.limit);

    if (pools.length === 0) {
      console.error(
        "No pools matched. Either the filters are too narrow or no registered resolver claims any project in the feed.",
      );
      process.exit(1);
    }

    console.log(
      `Resolving ${pools.length} pools (read-only; nothing is signed or written)\n`,
    );
    console.log(
      `${pad("CHAIN", 12)}${pad("PROJECT", 22)}${pad("SYMBOL", 16)}${pad("TVL", 12)}OUTCOME`,
    );
    console.log("-".repeat(110));

    const ctx = makeContext(mod);
    const byProject = new Map<string, { resolved: number; refused: number }>();
    /** Onboarding queue: what a protocol would be worth if it resolved. */
    const queue = new Map<
      string,
      {
        refused: number;
        tvlUsd: number;
        chains: Set<string>;
        sample: string[];
        shape: string;
      }
    >();
    const outcomes: Record<string, number> = {};

    for (const pool of pools) {
      let outcome: Outcome;
      try {
        const target = await mod.resolveTarget(pool as never, ctx as never);
        if (target) {
          outcome = {
            status: "resolved",
            kind: target.kind,
            destination: destinationOf(target),
          };
        } else {
          const misrouted = testnetMisroute(pool, mod);
          // A refusal on an unreachable or misrouted chain is not a verdict on
          // the address book — say so rather than letting it read as one.
          outcome = misrouted
            ? { status: "testnet-misroute", chainId: misrouted }
            : reachableFor(pool, reachable, mod)
              ? { status: "refused" }
              : { status: "chain-unreachable" };
        }
      } catch (err) {
        outcome = {
          status: "error",
          detail: (err as Error)?.message?.split("\n")[0] ?? String(err),
        };
      }

      outcomes[outcome.status] = (outcomes[outcome.status] ?? 0) + 1;
      if (outcome.status !== "resolved") {
        const q = queue.get(pool.project) ?? {
          refused: 0,
          tvlUsd: 0,
          chains: new Set<string>(),
          sample: [],
          shape: "",
        };
        // Rough triage so the queue does not read as "all of these are one
        // entry away". A paired symbol is an LP position, which needs an
        // execution KIND (adapter, validator, Layer-4 decode, Layer-5 pause),
        // not an extraction. Heuristic on purpose — it orders the work, it does
        // not decide anything.
        if (!q.shape) {
          const paired = /[-/]/.test(pool.symbol ?? "");
          const dated = /maturity|expiry|\d{1,2}[a-z]{3}\d{4}/i.test(
            pool.poolMeta ?? "",
          );
          q.shape = dated
            ? "dated market"
            : paired
              ? "LP pair — needs kind"
              : "single-asset";
        }
        q.refused++;
        q.tvlUsd += Number(pool.tvlUsd) || 0;
        q.chains.add(pool.chain);
        if (q.sample.length < 2) {
          q.sample.push(
            `${pool.chain} ${pool.symbol}${pool.poolMeta ? ` "${pool.poolMeta}"` : ""}`,
          );
        }
        queue.set(pool.project, q);
      }
      const tally = byProject.get(pool.project) ?? { resolved: 0, refused: 0 };
      if (outcome.status === "resolved") tally.resolved++;
      else tally.refused++;
      byProject.set(pool.project, tally);

      const tvl = `$${(pool.tvlUsd / 1_000_000).toFixed(1)}M`;
      const detail =
        outcome.status === "resolved"
          ? `✓ ${outcome.kind} → ${outcome.destination}`
          : outcome.status === "refused"
            ? "· manual (refused — fail-closed)"
            : outcome.status === "chain-unreachable"
              ? "? manual (chain unreachable — inconclusive)"
              : outcome.status === "testnet-misroute"
                ? `!! "${pool.chain}" resolves to TESTNET ${outcome.chainId} — fix the Blockchain row name`
                : `! error: ${outcome.detail}`;

      console.log(
        `${pad(pool.chain, 12)}${pad(pool.project, 22)}${pad(pool.symbol, 16)}${pad(tvl, 12)}${detail}`,
      );
      if (options.verbose && outcome.status !== "resolved") {
        console.log(
          `            poolId=${pool.pool} meta=${pool.poolMeta ?? "-"} underlying=${(pool.underlyingTokens ?? []).join(",") || "-"}`,
        );
      }
    }

    if (options.queue) {
      console.log(`\n${"=".repeat(110)}`);
      console.log("Onboarding queue — Manual protocols, biggest TVL first");
      console.log(
        "Each row is a protocol nothing can execute today, biggest TVL first.\n" +
          "\n" +
          "READ THE SHAPE COLUMN BEFORE PICKING ONE. Only `single-asset` is likely to\n" +
          "be an extraction (one protocols.ts entry). `LP pair` and `dated market` need\n" +
          "a new execution kind — adapter, validator, Layer-4 decode, Layer-5 pause —\n" +
          "which is a different and much larger piece of work. The shape is a heuristic\n" +
          "from the pool symbol, so confirm it against the protocol's own docs.\n" +
          "\n" +
          "Resolving here is NOT shipping: see runbook §12.3 for what production needs.\n",
      );
      const rows = [...queue]
        .filter(([project]) => (byProject.get(project)?.resolved ?? 0) === 0)
        .sort((a, b) => b[1].tvlUsd - a[1].tvlUsd)
        .slice(0, 25);
      if (rows.length === 0) {
        console.log(
          "  (nothing fully Manual — every project resolved at least one pool)",
        );
      }
      for (const [project, q] of rows) {
        const tvl =
          q.tvlUsd >= 1e9
            ? `$${(q.tvlUsd / 1e9).toFixed(2)}B`
            : q.tvlUsd >= 1e6
              ? `$${(q.tvlUsd / 1e6).toFixed(1)}M`
              : `$${(q.tvlUsd / 1e3).toFixed(0)}K`;
        console.log(
          `  ${pad(project, 30)} ${tvl.padStart(8)}  ${String(q.refused).padStart(3)} pools  ${pad(q.shape, 22)} [${[...q.chains].sort().join(", ")}]`,
        );
        console.log(`     e.g. ${q.sample.join(" · ")}`);
      }
    }

    const loose = substringMatchReport();
    if (loose.length > 0) {
      console.log(`\n${"=".repeat(110)}`);
      console.log("!! Slugs that reached a resolver only by SUBSTRING");
      console.log(
        "Nobody claims these slugs outright, so a family that merely looks like them\n" +
          "answered. This has mis-routed funds twice (spark-savings -> SparkLend,\n" +
          "aave-v4 -> the Aave v3 Pool) and BOTH validated cleanly. Review each row:\n" +
          "if it is not the same protocol, add a `reserved` entry in protocols.ts.\n",
      );
      for (const m of loose) {
        console.log(`  ${pad(m.slug, 34)} served by: ${m.families.join(", ")}`);
      }
    }

    const health = candidateSourceHealth();
    if (health.length > 0) {
      console.log(`\n${"=".repeat(110)}`);
      console.log("Discovery health — where candidate addresses came from");
      for (const h of [...health].sort((a, b) => b.hits - a.hits)) {
        const flag = h.dark ? "  << DARK" : "";
        console.log(
          `  ${pad(h.id, 30)} ${String(h.hits).padStart(4)} hits  ${String(h.misses).padStart(4)} miss  ${String(h.errors).padStart(3)} err${flag}`,
        );
      }
      if (health.some((h) => h.dark)) {
        console.log(
          "\n  A DARK source answered nothing at all. That is indistinguishable from\n" +
            "  'these pools are not ours' unless someone looks, which is how the /poolsOld\n" +
            "  outage went unnoticed. Check the endpoint before assuming no coverage.",
        );
      }
    }

    console.log(`\n${"=".repeat(110)}`);
    console.log("Summary by project");
    for (const [project, tally] of [...byProject].sort(
      (a, b) => b[1].resolved - a[1].resolved,
    )) {
      const total = tally.resolved + tally.refused;
      console.log(
        `  ${pad(project, 24)} ${String(tally.resolved).padStart(3)}/${String(total).padEnd(3)} resolved`,
      );
    }
    console.log("");
    for (const [status, count] of Object.entries(outcomes)) {
      console.log(`  ${pad(status, 20)} ${count}`);
    }
    if (outcomes["testnet-misroute"]) {
      console.log(
        `\n  !! ${outcomes["testnet-misroute"]} pools resolved their chain to a TESTNET row.`,
      );
      console.log(
        "     This is a Blockchain-table naming problem, not an address-book problem: a mainnet",
      );
      console.log(
        "     catalog name is matching a testnet row, so no pinned mainnet address can ever match.",
      );
      console.log(
        "     Fix the row name, or alias it: STRATEGIES_CHAIN_ALIASES='{\"base\":8453}'",
      );
    }
    console.log(
      "\nA refusal is the correct-by-default outcome, not a bug: the pool degrades to the Manual deep link.",
    );
    console.log(
      "Investigate a project whose pools ALL refuse — that usually means a pinned address or a match key is wrong.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * DeFiLlama's feed is mainnet-only, so a catalog chain name that resolves to a
 * TESTNET row is always a `Blockchain` naming problem, never a real refusal —
 * and it silently disables every pool on that chain. Seen in the wild: the
 * mainnet row named "Base Mainnet" while the Sepolia row is named "Base", so
 * DeFiLlama's "Base" resolved to 84532 and no Base pool could ever match a
 * pinned 8453 address. Called out as its own outcome so it cannot be mistaken
 * for the address book failing.
 */
function testnetMisroute(pool: Pool, mod: ResolverModules): number | null {
  const chainId = mod.resolveEvmChainId(pool.chain);
  if (!chainId) return null;
  const row = mod.findChainById(chainId);
  return row?.isTestnet ? chainId : null;
}

/** Was the pool's chain one we could actually talk to? */
function reachableFor(
  pool: Pool,
  reachable: Set<number>,
  mod: ResolverModules,
): boolean {
  const chainId = mod.resolveEvmChainId(pool.chain);
  // chainId 0 means the chain is not in the directory at all — a real refusal
  // (we do not support it), not an RPC problem.
  return chainId === 0 || reachable.has(chainId);
}

main().catch((err) => {
  console.error(
    `[defi:dry-run] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  process.exit(1);
});
