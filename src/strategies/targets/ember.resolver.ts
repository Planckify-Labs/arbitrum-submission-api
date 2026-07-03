/**
 * Ember Vaults resolver (Sui) — spec §3.1, §5, §7.1 / Phase 3.
 *
 * Ember (Bluefin-incubated) is a generic tokenized-vault protocol — the Sui
 * analog of the ERC-4626 family — so the whole protocol maps to ONE mobile
 * adapter (`EmberSuiAdapter`), dispatched by `{ kind: "ember-vault" }`. This
 * resolver's only job is to turn a DeFiLlama Ember pool's matching keys —
 * `(underlyingTokens[0], poolMeta, chain=Sui)` — into the concrete
 * `{ vault, coinType, shareType }`.
 *
 * Source = the Bluefin Ember Vaults API (§3.1: prefer the plain HTTPS endpoint
 * over the SDK). Two endpoints, joined on the vault object id:
 *   - `/api/v1/vaults`      → { id, name, depositCoin.symbol } — `name` is what
 *                             DeFiLlama surfaces as `poolMeta`.
 *   - `/api/v1/vaults/info` → Vaults[Name] = { ObjectId, DepositCoinType (T),
 *                             ReceiptCoinType (R) } — the coin TYPES (the list
 *                             endpoint only carries symbols).
 * Match `poolMeta` against the LIST `name`, join `id → info.ObjectId` for the
 * types. Validate the Vault object on-chain before trusting it (§3.2).
 *
 * Fail closed: no confident match / failed validation → `null` → the pool
 * stays "manual". Never guess an object id.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import {
  eqSuiCoinType,
  getSuiObjectType,
  normSuiType,
  suiValidationEnabled,
} from "./sui-rpc";
import type {
  DepositTarget,
  PoolTargetResolver,
  ResolverContext,
} from "./types";

const VAULT_LIST_TTL_SEC = 30 * 60; // matches the poll cadence
const EMBER_VAULTS_BASE = "https://vaults.api.sui-prod.bluefin.io/api/v1";

interface EmberListVault {
  id: string;
  name?: string;
  depositCoin?: { symbol?: string } | null;
}

interface EmberInfoVault {
  ObjectId?: string;
  Name?: string;
  DepositCoinType?: string;
  ReceiptCoinType?: string;
}

interface EmberInfoPayload {
  VaultProtocol?: { Package?: string; ProtocolConfig?: string };
  Vaults?: Record<string, EmberInfoVault>;
}

/** Normalise a vault label for fuzzy matching (poolMeta ↔ list name). */
function normLabel(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function labelMatches(poolMeta: string, name: string | null | undefined): boolean {
  const needle = normLabel(poolMeta);
  const hay = normLabel(name);
  if (!needle || !hay) return false;
  return hay === needle || hay.includes(needle) || needle.includes(hay);
}

/**
 * On-chain validation (§3.2): the vault object exists and its `Vault<T, R>`
 * type carries the expected deposit + receipt coin types. Any failure →
 * false → the resolver nulls the target. Toggle off for local dev with
 * `STRATEGIES_TARGET_VALIDATION=off`.
 */
async function validateEmberVault(
  target: Extract<DepositTarget, { kind: "ember-vault" }>,
): Promise<boolean> {
  if (!suiValidationEnabled()) return true;
  const type = await getSuiObjectType(target.vault);
  if (!type) return false;
  // The Vault<T,R> type string embeds both coin types; require both present.
  const norm = normSuiType(type);
  return (
    norm.includes(normSuiType(target.coinType)) &&
    norm.includes(normSuiType(target.shareType))
  );
}

async function fetchList(ctx: ResolverContext): Promise<EmberListVault[]> {
  const res = await ctx.fetchJsonCached<EmberListVault[]>(
    "defillama:targets:ember:vaults:v1",
    `${EMBER_VAULTS_BASE}/vaults`,
    VAULT_LIST_TTL_SEC,
  );
  return Array.isArray(res) ? res : [];
}

async function fetchInfo(ctx: ResolverContext): Promise<EmberInfoVault[]> {
  const res = await ctx.fetchJsonCached<EmberInfoPayload>(
    "defillama:targets:ember:info:v1",
    `${EMBER_VAULTS_BASE}/vaults/info`,
    VAULT_LIST_TTL_SEC,
  );
  return res?.Vaults ? Object.values(res.Vaults) : [];
}

export const EmberResolver: PoolTargetResolver = {
  family: "ember",
  aliases: ["ember-protocol", "ember"],
  async resolve(pool, ctx): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "sui") return null;
    const underlying = pool.underlyingTokens?.[0];
    if (!underlying) return null;

    const [list, info] = await Promise.all([fetchList(ctx), fetchInfo(ctx)]);
    if (list.length === 0 || info.length === 0) return null;

    // Candidate vaults: those whose (info) deposit coin type is the pool's
    // underlying. Join each to its list entry (id === ObjectId) for the
    // DeFiLlama-facing `name` used to disambiguate siblings via poolMeta.
    const byId = new Map(
      list.filter((v) => v.id).map((v) => [v.id.toLowerCase(), v]),
    );
    const candidates = info
      .filter(
        (v) =>
          v.ObjectId &&
          v.DepositCoinType &&
          v.ReceiptCoinType &&
          eqSuiCoinType(v.DepositCoinType, underlying),
      )
      .map((v) => ({ info: v, list: byId.get(v.ObjectId!.toLowerCase()) }));
    if (candidates.length === 0) return null;

    let match: (typeof candidates)[number] | undefined;
    if (pool.poolMeta) {
      const meta = normLabel(pool.poolMeta);
      // EXACT normalized name first. A substring match alone is unsafe when
      // siblings share the same underlying: "USD Vault" is a substring of
      // "Crosschain USD Vault" and both are USDC (both pass on-chain
      // validation), so a pure `.find(substring)` could route funds to the
      // wrong vault. Only fall back to fuzzy when there's no exact hit.
      match =
        candidates.find(
          (c) =>
            normLabel(c.list?.name) === meta || normLabel(c.info.Name) === meta,
        ) ??
        candidates.find(
          (c) =>
            labelMatches(pool.poolMeta!, c.list?.name) ||
            labelMatches(pool.poolMeta!, c.info.Name),
        );
    }
    // No poolMeta (or no name hit): only accept a single unambiguous vault.
    if (!match && !pool.poolMeta && candidates.length === 1) match = candidates[0];
    if (!match) return null;

    const target: DepositTarget = {
      kind: "ember-vault",
      vault: match.info.ObjectId!,
      coinType: match.info.DepositCoinType!,
      shareType: match.info.ReceiptCoinType!,
    };
    return (await validateEmberVault(target)) ? target : null;
  },
};
