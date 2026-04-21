/**
 * Type definitions for Circle Gateway `GET /gateway/v1/x402/supported`.
 *
 * Spec ref: umkm-usdc-payout-spec.md §6.5.
 * The response enumerates per-network payment kinds (EIP-3009 on EVM, Solana
 * x402 on SVM) and the EIP-712 domain (`verifyingContract` for EVM) the mobile
 * app must sign against. We cache this at backend boot + 12h cron so mobile
 * learns about chain rotation via the enriched `GET /v1/blockchains` response.
 */

/** A single `kind` entry per network from Circle. Shape matches Circle's
 *  OpenAPI: `scheme`, `network` (CAIP-2 string), optional `extra` block with
 *  EIP-712 domain values on EVM networks. */
export interface TX402SupportedKind {
  /** x402 scheme variant. `"exact"` for EIP-3009 EVM; `"exact"` with SVM
   *  `extra.feePayer` for Solana. */
  scheme: string;
  /** CAIP-2 network identifier — e.g. `"eip155:5042002"` (Arc Testnet),
   *  `"eip155:8453"` (Base mainnet), `"solana:mainnet"`. */
  network: string;
  /** USDC asset address for EVM (`0x…`) or SPL mint for Solana. */
  asset?: string;
  /** EIP-712 domain values for EVM networks. Circle advertises the
   *  `GatewayWallet` contract here — mobile signs `TransferWithAuthorization`
   *  typed-data against this. */
  extra?: {
    /** e.g. `"GatewayWalletBatched"` */
    name?: string;
    /** e.g. `"1"` */
    version?: string;
    /** `GatewayWallet` contract address on this chain. 20-byte hex on EVM. */
    verifyingContract?: string;
    /** Solana-specific: fee payer for x402 SVM scheme. */
    feePayer?: string;
    /** Any additional chain-specific metadata Circle ships. */
    [key: string]: unknown;
  };
  /** Authorized signer addresses Circle accepts on this network. */
  authorizedSigners?: string[];
}

/** Top-level response shape. Circle returns `{ kinds: [...] }` per their OpenAPI. */
export interface TX402SupportedResponse {
  kinds: TX402SupportedKind[];
}

/** Normalized, per-chain lookup entry for `getSupportedForChain(chainId)`.
 *  `chainId` is extracted from the CAIP-2 `eip155:<chainId>` prefix; SVM
 *  entries surface with `chainId = null` and `namespace = "solana"`. */
export interface TX402ChainEntry {
  namespace: "eip155" | "solana" | string;
  chainId: number | null;
  network: string;
  scheme: string;
  asset: string | null;
  domainName: string | null;
  domainVersion: string | null;
  verifyingContract: string | null;
  authorizedSigners: string[];
}

/** Minimal HTTP client interface so the service is testable without a real
 *  `fetch`. Tests inject a mock that returns canned responses. */
export interface IX402HttpClient {
  get(url: string, signal?: AbortSignal): Promise<TX402SupportedResponse>;
}
