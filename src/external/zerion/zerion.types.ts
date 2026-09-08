/**
 * Wire types for the portfolio read layer.
 *
 * Field paths below were taken from the published schema
 * (https://developers.zerion.io/reference/listwalletpositions and
 * /listwalletnftpositions, read 2026-09-04) plus the live-capture notes on
 * `ZerionClient.getDefiPositions`. They are not guessed.
 */

/**
 * Every portfolio fetcher returns this envelope.
 *
 * `status: "indexing"` means Zerion answered 202 Accepted — it has not
 * finished indexing this wallet yet, and `data` is empty rather than
 * incomplete-but-plausible. Callers poll; they must never persist it.
 */
export interface ZerionResult<T> {
  status: "ready" | "indexing";
  data: T;
  /** ISO timestamp of when the underlying Zerion data was retrieved. */
  fetchedAt: string;
  /** True when served from Valkey without touching Zerion. */
  fromCache: boolean;
  /** Set when a `refresh` was rate-limited and the cached entry was served. */
  throttled?: boolean;
  /** Opaque cursor for the next page, when the endpoint paginates. */
  nextCursor?: string | null;
}

/**
 * One asset a wallet is known to touch. Deliberately IDENTITY ONLY — there is
 * no quantity and no USD value here.
 *
 * Balances are read on-chain by the client, so a third party's number is never
 * rendered as the user's balance, and the set of assets (which changes rarely)
 * is the only thing worth spending a metered request on.
 */
export interface DiscoveredAsset {
  /** CAIP namespace of the chain this implementation lives on. */
  namespace: "eip155" | "solana";
  /** Our numeric chain id; `null` for non-EVM chains. */
  chainId: number | null;
  /**
   * Contract address (EVM) or mint address (Solana). `null` marks the chain's
   * native coin, which has no contract.
   */
  address: string | null;
  symbol: string;
  name: string;
  decimals: number;
  /**
   * `fungible_info.icon.url`. Nullable in Zerion's schema, so consumers must
   * keep their existing placeholder path rather than assuming a logo exists.
   */
  logoUrl: string | null;
  /** `fungible_info.flags.verified` — an input to spam scoring, not a bypass. */
  verified: boolean;
}

/** A protocol position: supplied, borrowed, staked, locked or claimable. */
export interface ZerionDefiPosition {
  /** `relationships.dapp.data.id`, a kebab-case protocol slug. */
  dappId: string | null;
  protocolName: string | null;
  poolAddress: string | null;
  zerionChainId: string;
  chainId: number | null;
  assetSymbol: string;
  assetContract: string | null;
  quantityRaw: string;
  decimals: number;
  /**
   * Zerion's own valuation. Unlike an ERC-20 balance we have no cheap generic
   * on-chain read for an arbitrary protocol position, so this is passed
   * through and must be labelled an estimate wherever it is shown.
   */
  valueUsd: number | null;
  logoUrl: string | null;
  /**
   * `attributes.position_type`. `deposit`/`staked` are principal;
   * `borrowed` is a liability; `reward` is claimable; `locked` is vesting.
   */
  status: ZerionPositionStatus;
}

export type ZerionPositionStatus =
  | "deposit"
  | "staked"
  | "locked"
  | "reward"
  | "borrowed";

export const ZERION_POSITION_STATUSES: readonly ZerionPositionStatus[] = [
  "deposit",
  "staked",
  "locked",
  "reward",
  "borrowed",
];

/** One NFT a wallet holds, shaped for the mobile `NFTAsset` mapper. */
export interface ZerionNftPosition {
  chainId: number | null;
  namespace: "eip155" | "solana";
  contractAddress: string;
  tokenId: string;
  /** `amount` — >1 only for ERC-1155. */
  amount: number;
  name: string | null;
  description: string | null;
  /** `nft_info.content.preview.url` */
  previewUrl: string | null;
  /** `nft_info.content.detail.url` */
  detailUrl: string | null;
  collectionName: string | null;
  /** `collection_info.content.icon.url` */
  collectionIconUrl: string | null;
  /** `price` — collection floor in the requested currency. */
  floorPrice: number | null;
  /** `value` — floor valuation of this holding. */
  valueUsd: number | null;
}
