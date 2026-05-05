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
  isEVM: boolean;
  isActive: boolean;
  isTestnet: boolean | null;
  updatedAt: Date;
  gatewayWalletContract: string | null;
  gatewayMinterContract: string | null;
  paymasterAddress: string | null;
  x402DomainName: string | null;
  x402DomainVersion: string | null;
  x402VerifyingContract: string | null;
  x402FacilitatorUrl: string | null;
  tokens?: TTokenRow[] | null;
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
  if (row.isEVM && row.chainId != null) {
    return `eip155:${row.chainId}`;
  }
  // Non-EVM rows are keyed by `chainSlug` (e.g. `sui-mainnet`,
  // `solana-devnet`). Translate to CAIP-2:
  //   `sui-mainnet`    → `sui:mainnet`
  //   `sui-testnet`    → `sui:testnet`
  //   `sui-devnet`     → `sui:devnet`
  //   `solana-mainnet` → `solana:mainnet-beta`  (Solana CAIP-2 uses
  //                                             "mainnet-beta")
  //   `solana-devnet`  → `solana:devnet`
  if (typeof row.chainSlug === "string") {
    if (row.chainSlug.startsWith("sui-")) {
      return `sui:${row.chainSlug.slice("sui-".length)}`;
    }
    if (row.chainSlug.startsWith("solana-")) {
      const cluster = row.chainSlug.slice("solana-".length);
      return cluster === "mainnet" ? "solana:mainnet-beta" : `solana:${cluster}`;
    }
  }
  return null;
}

export function buildGateway(
  row: TBlockchainRow,
): GatewayContractsDto | null {
  if (!row.gatewayWalletContract || !row.gatewayMinterContract) {
    return null;
  }
  return {
    walletContract: row.gatewayWalletContract,
    minterContract: row.gatewayMinterContract,
  };
}

export function buildPaymaster(row: TBlockchainRow): PaymasterDto | null {
  if (!row.paymasterAddress) {
    return null;
  }
  return { address: row.paymasterAddress };
}

/**
 * Build the x402 nested object. Reads DB columns first; if any of the three
 * EIP-712-mandatory values (domainName, domainVersion, verifyingContract) are
 * null, falls back to the Circle-supplied in-memory snapshot. This is the
 * "task 22 may not have written DB yet" safety net described in task 21 scope
 * item 1d.
 */
export function buildX402(
  row: TBlockchainRow,
  x402Svc?: X402SupportedService | null,
): X402DomainDto | null {
  let domainName = row.x402DomainName;
  let domainVersion = row.x402DomainVersion;
  let verifyingContract = row.x402VerifyingContract;
  const facilitatorUrl = row.x402FacilitatorUrl;

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
    rpcUrl: row.rpcUrl,
    blockExplorer: row.blockExplorer,
    isEVM: row.isEVM,
    isActive: row.isActive,
    isTestnet: row.isTestnet ?? false,
    nativeCurrency: buildNativeCurrency(row),
    gateway: buildGateway(row),
    paymaster: buildPaymaster(row),
    x402: buildX402(row, x402Svc),
    usdc: buildUsdc(row),
    tokens: (row.tokens ?? []).filter((t) => t.isActive),
    updatedAt: row.updatedAt,
  };
}
