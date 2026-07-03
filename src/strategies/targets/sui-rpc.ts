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
type SuiClientCtor = new (opts: { url: string }) => SuiClientLike;
type GetFullnodeUrl = (network: string) => string;

const dynamicImport = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<Record<string, unknown>>;

let clientPromise: Promise<SuiClientLike> | null = null;

async function getClient(): Promise<SuiClientLike> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const mod = await dynamicImport("@mysten/sui/client");
      const SuiClient = mod.SuiClient as SuiClientCtor;
      const getFullnodeUrl = mod.getFullnodeUrl as GetFullnodeUrl;
      const url =
        process.env.STRATEGIES_SUI_RPC_URL?.trim() ||
        getFullnodeUrl("mainnet");
      return new SuiClient({ url });
    })();
  }
  return clientPromise;
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
export function eqSuiCoinType(
  a?: string | null,
  b?: string | null,
): boolean {
  if (!a || !b) return false;
  return normSuiType(a) === normSuiType(b);
}
