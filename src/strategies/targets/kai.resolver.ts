/**
 * Kai Finance Single Asset Vaults resolver (Sui) — spec §3.1, §5, §7.1 /
 * Phase 3. Found + built 2026-08-22.
 *
 * Kai's SAVs are a generic tokenized vault, structurally close to Ember's
 * `Vault<T,R>` (deposit coin T, receipt/share coin Y) but a DIFFERENT,
 * independently-deployed Move package — not built on Ember's or Suilend's
 * generic module, verified by reading both packages' on-chain module names
 * (Kai's struct is `vault::Vault<T,Y>` with a `WitTable`-backed reserve store;
 * Ember's is a different module entirely). Hence its own `kind`, resolver and
 * mobile adapter, per this codebase's established Sui rule: no vault
 * standard, one bespoke pair per protocol.
 *
 * Kai has no public HTTPS discovery API and no on-chain factory/registry to
 * enumerate — `DefiLlama/yield-server`'s own `kai-finance` adaptor hardcodes
 * the same fixed 11-vault list this resolver pins below (verified against
 * the live adaptor source 2026-08-22: github.com/DefiLlama/yield-server/
 * blob/master/src/adaptors/kai-finance/index.js). That list is the "protocol's
 * own source" here in the sense the runbook means it (§11.5c Step 1) — Kai's
 * own team maintains that adaptor — but it is still just a pin, so `coinType`
 * is cross-checked against `pool.underlyingTokens[0]` before trusting it, the
 * same as every other Sui resolver. `shareType` is deliberately NOT pinned:
 * it's read live off the vault object's own on-chain type (one string parse,
 * no extra RPC call — it's the same read the existence/type validation
 * already does), which is one fewer hand-copied constant to go stale.
 *
 * Fail closed: no coinType match / underlying mismatch / unreadable or
 * malformed vault type → `null` → manual.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { eqSuiCoinType, getSuiObjectType } from "./sui-rpc";
import type { DepositTarget, PoolTargetResolver } from "./types";

/**
 * Pinned vault list (mirrors `DefiLlama/yield-server`'s `kai-finance` adaptor,
 * verified 2026-08-22). `coinType` is the deposit asset (T) — the cross-check
 * key against `pool.underlyingTokens[0]`.
 */
const KAI_VAULTS: readonly { vault: string; coinType: string }[] = [
  {
    vault: "0x7a2f75a3e50fd5f72dfc2f8c9910da5eaa3a1486e4eb1e54a825c09d82214526",
    coinType:
      "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN", // wUSDC
  },
  {
    vault: "0x0fce8baed43faadf6831cd27e5b3a32a11d2a05b3cd1ed36c7c09c5f7bcb4ef4",
    coinType:
      "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN", // wUSDT
  },
  {
    vault: "0x16272b75d880ab944c308d47e91d46b2027f55136ee61b3db99098a926b3973c",
    coinType: "0x2::sui::SUI",
  },
  {
    vault: "0x3e8a6d1e29d2c86aed50d6055863b878a7dd382de22ea168177c80c1d7150061",
    coinType:
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  },
  {
    vault: "0xbfcab5f22e253be0768e2cc5e75e170c5266edf7b68c813af0d676e84285681c",
    coinType:
      "0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT",
  },
  {
    vault: "0x02ec915b35fb958ca9a7d94e57d7254513ff711832ba8aebfc0ac3395152260b",
    coinType:
      "0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY",
  },
  {
    vault: "0x6e58792dccbaa1d1d708d9a847a7c5b3f90c7878d1b76fd79afa48d31063bca6",
    coinType:
      "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
  },
  {
    vault: "0x4ee20ca2594e137a1388d5de03c0b1f3dd7caddefb4c55b1c7bca15d0fe18c86",
    coinType:
      "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL",
  },
  {
    vault: "0x5674aae155d38e09edaf3163f2e3f85fe77790f484485f0b480ca55915d7c446",
    coinType:
      "0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC", // wBTC
  },
  {
    vault: "0x362ce1fc1425ec0bdf958f2023b07cda52c924fa42e4ff88a9a48c595fd8437d",
    coinType:
      "0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC",
  },
  {
    vault: "0x653beede5a005272526f0c835c272ef37491dc5bff3f8e466175e02675510137",
    coinType:
      "0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC",
  },
];

/**
 * Split the two type arguments out of a `…::vault::Vault<A, B>` type string.
 * Depth-aware (not a naive `split(",")`) in case either type argument ever
 * carries its own generic — Sui coin types don't today, but failing closed on
 * an unexpected shape is cheap and this makes no shape assumption either way.
 */
function vaultTypeArgs(type: string): [string, string] | null {
  const open = type.indexOf("::Vault<");
  if (open < 0 || !type.endsWith(">")) return null;
  const inner = type.slice(open + "::Vault<".length, -1);
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<") depth++;
    else if (ch === ">") depth--;
    else if (ch === "," && depth === 0) {
      const a = inner.slice(0, i).trim();
      const b = inner.slice(i + 1).trim();
      return a && b ? [a, b] : null;
    }
  }
  return null;
}

export const KaiResolver: PoolTargetResolver = {
  family: "kai-finance",
  aliases: ["kai-finance", "kai"],
  async resolve(pool, _ctx): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "sui") return null;
    const underlying = pool.underlyingTokens?.[0];
    if (!underlying) return null;

    const match = KAI_VAULTS.find((v) => eqSuiCoinType(v.coinType, underlying));
    if (!match) return null;

    // Unconditional (not gated by `suiValidationEnabled()`, unlike Ember/
    // Scallop/NAVI's OPTIONAL extra check) — mirrors Suilend's resolver:
    // `shareType` is only knowable by reading the vault live, so this read is
    // both the existence/coinType validation AND the source of a required
    // field, not an optional confirmation on top of an otherwise-complete
    // target.
    const type = await getSuiObjectType(match.vault);
    if (!type) return null;
    const args = vaultTypeArgs(type);
    if (!args) return null;
    const [coinType, shareType] = args;
    if (!eqSuiCoinType(coinType, underlying)) return null;

    return { kind: "kai-vault", vault: match.vault, coinType, shareType };
  },
};
