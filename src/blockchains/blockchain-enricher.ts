import type { X402SupportedService } from "../x402/x402-supported.service";
import type {
  EnrichedBlockchainResponseDto,
  GatewayContractsDto,
  NativeCurrencyDto,
  PaymasterDto,
  UsdcTokenDto,
  X402DomainDto,
} from "./dto/enriched-blockchain-response.dto";

/**
 * Pure mapping from a Prisma `Blockchain` row (plus its joined `tokens`) into
 * the wire-level {@link EnrichedBlockchainResponseDto}. Split out from the
 * service so unit tests don't need to stand up Nest.
 *
 * Spec ref: umkm-usdc-payout-spec.md §6.7, task 21.
 *
 * **x402 fallback rule** (see task 21 scope item 1d): if the DB doesn't yet
 * carry the x402 domain columns for a chain, we fall back to
 * `X402SupportedService.getSupportedForChain()`. That keeps this endpoint
 * useful even on clusters where task 22's boot-write to DB hasn't landed.
 * When both the DB and the in-memory snapshot are empty, `x402: null`.
 *
 * **Nested-nullable discipline**: if every field for a nested object is
 * absent, we emit `null` for the whole object — not
 * `{ walletContract: null, minterContract: null }`. Matches mobile's
 * `gateway: { … } | null` contract.
 */

/** Minimal Prisma row shape we need. Avoids importing Prisma types at the
 *  serializer boundary. Extra columns are allowed. */
export interface TBlockchainRow {
  id: string;
  name: string;
  chainId: number | null;
  chainSlug?: string | null;
  rpcUrl: string;
  blockExplorer: string;
  // Chain family — "EVM" | "SVM" | "MOVE_VM" | "STELLAR". The public
  // `isEVM` field on EnrichedBlockchainResponseDto is derived from this at
  // serialization time (see enrichBlockchain below), not stored — mobile's
  // wire contract keeps the boolean, the DB doesn't duplicate it.
  type: string;
  isActive: boolean;
  isTestnet: boolean | null;
  updatedAt: Date;
  // Genuine per-chain config (not an address) — see the schema comment on
  // Blockchain.metadata for why this isn't a scalar column.
  metadata?: { x402DomainName?: string; x402DomainVersion?: string; x402FacilitatorUrl?: string } | null;
  tokens?: TTokenRow[] | null;
  SmartContract?: TSmartContractRow[] | null;
}

/** Finds a SmartContract row by its stable machine-key `name`, not a display label. */
function findContract(row: TBlockchainRow, name: string): TSmartContractRow | undefined {
  return row.SmartContract?.find((s) => s.isActive && s.name === name);
}

export interface TSmartContractRow {
  name: string;
  address: string;
  isActive: boolean;
}

export interface TTokenRow {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  blockchainId: string;
  contractAddress: string | null;
  logoUrl: string | null;
  isStablecoin: boolean;
  isNativeCurrency: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function buildCaip2Id(row: TBlockchainRow): string | null {
  if (row.type === "EVM" && row.chainId != null) {
    return `eip155:${row.chainId}`;
  }
  // Non-EVM rows are keyed by `chainSlug` (e.g. `sui-mainnet`,
  // `solana-devnet`). Translate to CAIP-2:
  //   `sui-mainnet`     → `sui:mainnet`
  //   `sui-testnet`     → `sui:testnet`
  //   `sui-devnet`      → `sui:devnet`
  //   `solana-mainnet`  → `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`
  //   `solana-devnet`   → `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`
  //   `stellar-mainnet` → `stellar:pubnet`
  //   `stellar-testnet` → `stellar:testnet`
  //
  // The slug is NOT the CAIP-2 reference for every family, so only Sui can
  // pass its cluster through verbatim:
  //
  //   - Solana's reference is the truncated cluster GENESIS HASH, not the
  //     RPC cluster name. This file used to emit `solana:mainnet-beta`,
  //     which is a real Solana identifier (the JSON-RPC cluster name, used
  //     correctly elsewhere e.g. `pay/intents.service.ts`) but not a valid
  //     CAIP-2 chain reference.
  //   - Stellar's (CAIP-28) reference is `pubnet`/`testnet`, not
  //     `mainnet` — see `bridge/providers/cctp-stellar.adapter.ts`. Stellar
  //     rows previously fell through to `null` entirely.
  //
  // Either mismatch silently breaks any exact-match lookup against
  // `TBlockchain.caip2Id` (e.g. the mobile bridge card's chain icons),
  // because the bridge pipeline emits the canonical forms
  // (`bridge/providers/lifi.mapping.ts`'s `NON_EVM_CAIP2_BY_LIFI_ID`,
  // `cctp-stellar.adapter.ts`) and so does mobile's `CHAIN_NAMES` table.
  // Keep these tables in sync with those if a cluster is added.
  if (typeof row.chainSlug === "string") {
    if (row.chainSlug.startsWith("sui-")) {
      return `sui:${row.chainSlug.slice("sui-".length)}`;
    }
    if (row.chainSlug.startsWith("solana-")) {
      const cluster = row.chainSlug.slice("solana-".length);
      return `solana:${SOLANA_CAIP2_REFERENCE_BY_CLUSTER[cluster] ?? cluster}`;
    }
    if (row.chainSlug.startsWith("stellar-")) {
      const network = row.chainSlug.slice("stellar-".length);
      return `stellar:${STELLAR_CAIP2_REFERENCE_BY_NETWORK[network] ?? network}`;
    }
  }
  return null;
}

/** Truncated cluster genesis hashes — Solana's CAIP-2 chain references. */
const SOLANA_CAIP2_REFERENCE_BY_CLUSTER: Record<string, string> = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

/** Stellar (CAIP-28) calls its mainnet `pubnet`; `testnet` matches verbatim. */
const STELLAR_CAIP2_REFERENCE_BY_NETWORK: Record<string, string> = {
  mainnet: "pubnet",
};

export function buildGateway(
  row: TBlockchainRow,
): GatewayContractsDto | null {
  const wallet = findContract(row, "gateway_wallet");
  const minter = findContract(row, "gateway_minter");
  if (!wallet || !minter) {
    return null;
  }
  return {
    walletContract: wallet.address,
    minterContract: minter.address,
  };
}

export function buildPaymaster(row: TBlockchainRow): PaymasterDto | null {
  const paymaster = findContract(row, "paymaster");
  if (!paymaster) {
    return null;
  }
  return { address: paymaster.address };
}

/**
 * Build the x402 nested object. Reads DB columns first; if any of the three
 * EIP-712-mandatory values (domainName, domainVersion, verifyingContract) are
 * null, falls back to the Circle-supplied in-memory snapshot. This is the
 * "task 22 may not have written DB yet" safety net described in task 21 scope
 * item 1d.
 *
 * `verifyingContract` resolves from a distinct "x402_verifying" SmartContract
 * row if one is seeded, else falls back to "gateway_wallet" — Circle's
 * Gateway wallet contract *is* the x402 EIP-712 verifying contract by
 * protocol design on every chain seeded so far, not a coincidence, so a
 * chain doesn't need to duplicate the same address under a second name
 * unless it genuinely differs.
 */
export function buildX402(
  row: TBlockchainRow,
  x402Svc?: X402SupportedService | null,
): X402DomainDto | null {
  let domainName = row.metadata?.x402DomainName ?? null;
  let domainVersion = row.metadata?.x402DomainVersion ?? null;
  let verifyingContract =
    findContract(row, "x402_verifying")?.address ??
    findContract(row, "gateway_wallet")?.address ??
    null;
  const facilitatorUrl = row.metadata?.x402FacilitatorUrl ?? null;

  const missingCore = !domainName || !domainVersion || !verifyingContract;
  if (missingCore && x402Svc && row.chainId != null) {
    const fallback = x402Svc.getSupportedForChain(row.chainId);
    if (fallback) {
      domainName = domainName ?? fallback.domainName;
      domainVersion = domainVersion ?? fallback.domainVersion;
      verifyingContract = verifyingContract ?? fallback.verifyingContract;
    }
  }

  if (!domainName || !domainVersion || !verifyingContract) {
    return null;
  }

  return {
    domainName,
    domainVersion,
    verifyingContract,
    facilitatorUrl: facilitatorUrl ?? null,
  };
}

/**
 * Native currency is surfaced from the `tokens` row where
 * `isNativeCurrency = true`. For chains whose native is a true native (ETH),
 * `contractAddress` is null. On Arc, USDC is the native — so the address is
 * populated and `isNativeCurrency && isStablecoin` are both true on the same
 * token row (see seed in §7.1).
 */
export function buildNativeCurrency(
  row: TBlockchainRow,
): NativeCurrencyDto | null {
  const native = row.tokens?.find((t) => t.isNativeCurrency && t.isActive);
  if (!native) return null;
  return {
    symbol: native.symbol,
    decimals: native.decimals,
    address: native.contractAddress,
  };
}

/**
 * USDC token lookup. We first look for the canonical USDC row
 * (`isStablecoin && symbol === "USDC"`). If that row is also the native
 * currency (Arc), we surface both: the `nativeCurrency` entry AND the `usdc`
 * entry point at the same address, and `isNativeCurrency` reflects the dual
 * status.
 */
export function buildUsdc(row: TBlockchainRow): UsdcTokenDto | null {
  const usdc = row.tokens?.find(
    (t) =>
      t.isStablecoin &&
      t.isActive &&
      typeof t.symbol === "string" &&
      t.symbol.toUpperCase() === "USDC",
  );
  if (!usdc || !usdc.contractAddress) return null;
  return {
    address: usdc.contractAddress,
    decimals: usdc.decimals,
    symbol: usdc.symbol,
    isNativeCurrency: usdc.isNativeCurrency,
  };
}

export function enrichBlockchain(
  row: TBlockchainRow,
  x402Svc?: X402SupportedService | null,
): EnrichedBlockchainResponseDto {
  return {
    id: row.id,
    name: row.name,
    chainId: row.chainId,
    chainSlug: row.chainSlug ?? null,
    caip2Id: buildCaip2Id(row),
    // Left as the raw rpc-proxy route on purpose. Resolving to an absolute URL
    // happens at the response boundary (`BlockchainsService.applyRpcOrigin`),
    // *after* the Valkey read — so the cached payload mirrors the DB exactly and
    // changing RPC_PROXY_URL takes effect without flushing the cache.
    rpcUrl: row.rpcUrl,
    blockExplorer: row.blockExplorer,
    isEVM: row.type === "EVM",
    isActive: row.isActive,
    isTestnet: row.isTestnet ?? false,
    nativeCurrency: buildNativeCurrency(row),
    gateway: buildGateway(row),
    paymaster: buildPaymaster(row),
    x402: buildX402(row, x402Svc),
    usdc: buildUsdc(row),
    tokens: (row.tokens ?? []).filter((t) => t.isActive),
    smartContracts: (row.SmartContract ?? [])
      .filter((s) => s.isActive)
      .map((s) => ({ name: s.name, address: s.address })),
    updatedAt: row.updatedAt,
  };
}
