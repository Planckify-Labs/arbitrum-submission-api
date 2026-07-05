/**
 * Minimal read-only Sui RPC for pool-target validation (spec §3.2) — the Sui
 * twin of `rpc.ts` (which is EVM/viem-only). Non-EVM `DepositTarget` families
 * (Ember, Scallop, …) validate their resolved object here before the resolver
 * trusts it.
 *
 * `@mysten/sui` is ESM-only and the API is CommonJS (mirrors
 * `siws-sui.service.ts`), so the SDK is lazy-imported at first use. The
 * `Function()`-wrapped `import()` bypasses TS static resolution (the SDK's
 * `exports` map + `module: commonjs` disagree) while Node 22 loads the ESM
 * build at runtime.
 */

type SuiObjectFields = Record<string, unknown>;
type SuiClientLike = {
  getObject(input: {
    id: string;
    options?: { showType?: boolean; showContent?: boolean };
  }): Promise<{
    data?: {
      type?: string | null;
      content?: { fields?: SuiObjectFields } | null;
    } | null;
  }>;
};
type SuiClientCtor = new (opts: {
  url: string;
  network?: string;
}) => SuiClientLike;

const DEFAULT_SUI_RPC = "https://fullnode.mainnet.sui.io:443";

const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<Record<string, unknown>>;

let clientPromise: Promise<SuiClientLike> | null = null;

async function getClient(): Promise<SuiClientLike> {
  if (!clientPromise) {
    clientPromise = (async () => {
      // The installed `@mysten/sui` no longer exports `SuiClient`/`getFullnodeUrl`
      // from `@mysten/sui/client` — the JSON-RPC client moved to
      // `@mysten/sui/jsonRpc` as `SuiJsonRpcClient` (same client the mobile app
      // uses). Importing the old path silently yielded `undefined`, so EVERY Sui
      // read (object types + the LST staking APY) failed.
      const mod = await dynamicImport("@mysten/sui/jsonRpc");
      const SuiJsonRpcClient = mod.SuiJsonRpcClient as SuiClientCtor;
      const url = process.env.STRATEGIES_SUI_RPC_URL?.trim() || DEFAULT_SUI_RPC;
      return new SuiJsonRpcClient({ url, network: "mainnet" });
    })();
  }
  return clientPromise;
}

/**
 * Retry a Sui RPC call: the public mainnet fullnode's DNS rotates onto an
 * occasionally-dead IP, so single-shot reads fail intermittently. Short backoff,
 * a few tries — enough to get one good response before the caller falls back.
 */
async function suiRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw lastErr;
}

/** True when target validation is enabled (default on; `…=off` for local dev). */
export function suiValidationEnabled(): boolean {
  return (
    (process.env.STRATEGIES_TARGET_VALIDATION ?? "on").toLowerCase() !== "off"
  );
}

/**
 * Read a shared object's fully-qualified Move type (e.g.
 * `0x…::vault::Vault<0x…::usdc::USDC, 0x…::eusdc::EUSDC>`), or `null` when it
 * can't be read. Best-effort — callers fail closed on `null`.
 */
export async function getSuiObjectType(id: string): Promise<string | null> {
  try {
    const client = await getClient();
    const obj = await client.getObject({ id, options: { showType: true } });
    return obj.data?.type ?? null;
  } catch {
    return null;
  }
}

/**
 * Read a shared object's Move content fields (e.g. a Suilend `LendingMarket`'s
 * `reserves` vector), or `null` when it can't be read. Best-effort — callers
 * fail closed on `null`.
 */
export async function getSuiObjectFields(
  id: string,
): Promise<SuiObjectFields | null> {
  try {
    const client = await getClient();
    const obj = await client.getObject({ id, options: { showContent: true } });
    return obj.data?.content?.fields ?? null;
  } catch {
    return null;
  }
}

type SuiStakingClient = {
  getValidatorsApy(): Promise<{
    apys?: { address: string; apy: number }[];
  }>;
  getLatestSuiSystemState(): Promise<{
    activeValidators?: { suiAddress: string; stakingPoolSuiBalance: string }[];
  }>;
};

/**
 * Current Sui network staking APY as a FRACTION (e.g. `0.026` = 2.6%),
 * stake-weighted across active validators. This is the underlying yield every
 * SUI liquid-staking token delivers (net of each venue's small fee), and the
 * honest APY the synthesized LST opportunity rows carry — computed live from
 * `getValidatorsApy` × validator stake, never hardcoded. Best-effort: returns
 * `null` on any RPC failure so the caller falls back to a cached last-good value
 * rather than fabricate a number.
 */
export async function getSuiNetworkStakingApy(): Promise<number | null> {
  try {
    const client = (await getClient()) as unknown as SuiStakingClient;
    const [apyRes, sys] = await Promise.all([
      suiRetry(() => client.getValidatorsApy()),
      suiRetry(() => client.getLatestSuiSystemState()),
    ]);
    const stake = new Map<string, number>();
    for (const v of sys.activeValidators ?? []) {
      stake.set(v.suiAddress, Number(v.stakingPoolSuiBalance ?? "0"));
    }
    let weightedApy = 0;
    let totalStake = 0;
    for (const a of apyRes.apys ?? []) {
      const w = stake.get(a.address) ?? 0;
      if (a.apy > 0 && w > 0) {
        weightedApy += a.apy * w;
        totalStake += w;
      }
    }
    if (totalStake === 0) return null;
    return weightedApy / totalStake;
  } catch {
    return null;
  }
}

/**
 * Normalise a Move type/coin-type string for containment checks: lowercase and
 * collapse leading address zeros so `0x2::sui::SUI` matches inside a
 * `0x000…0002::sui::SUI` type parameter.
 */
export function normSuiType(s: string): string {
  return s.toLowerCase().replace(/0x0+/g, "0x");
}

/**
 * Compare two Sui coin types tolerating address zero-padding + struct casing.
 * `0x2::sui::SUI` == `0x000…0002::sui::SUI`; `…::usdc::USDC` == `…::usdc::usdc`.
 */
export function eqSuiCoinType(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return normSuiType(a) === normSuiType(b);
}
