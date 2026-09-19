/**
 * Wire shape of a Zerion transaction-subscription callback
 * (developers.zerion.io/webhooks). Everything is optional on purpose: the
 * handler must survive a field Zerion drops or renames, and only the
 * fields the classifier actually reads are typed.
 */

export interface ZerionQuantity {
  int?: string;
  decimals?: number;
  float?: number;
  numeric?: string;
}

export interface ZerionFungibleInfo {
  id?: string;
  name?: string;
  symbol?: string;
  icon?: { url?: string | null } | null;
  flags?: { verified?: boolean };
  implementations?: Array<{
    chain_id?: string;
    address?: string | null;
    decimals?: number;
  }>;
}

export interface ZerionNftInfo {
  contract_address?: string;
  token_id?: string;
  name?: string;
  interface?: string;
  content?: {
    preview?: { url?: string | null } | null;
    detail?: { url?: string | null } | null;
  } | null;
  flags?: { is_spam?: boolean };
}

export interface ZerionTransfer {
  direction?: "in" | "out" | "self";
  quantity?: ZerionQuantity;
  value?: number | null;
  price?: number | null;
  sender?: string;
  recipient?: string;
  fungible_info?: ZerionFungibleInfo;
  nft_info?: ZerionNftInfo;
  act_id?: string;
}

export interface ZerionApproval {
  quantity?: ZerionQuantity;
  /** Zerion's name for the spender the wallet granted access to. */
  sender?: string;
  fungible_info?: ZerionFungibleInfo;
  nft_info?: ZerionNftInfo;
  act_id?: string;
}

export interface ZerionApplicationMetadata {
  name?: string;
  icon?: { url?: string | null } | null;
  contract_address?: string;
  method?: { id?: string; name?: string };
}

export type ZerionOperationType =
  | "approve"
  | "bid"
  | "burn"
  | "claim"
  | "delegate"
  | "deploy"
  | "deposit"
  | "execute"
  | "mint"
  | "receive"
  | "revoke"
  | "revoke_delegation"
  | "send"
  | "trade"
  | "withdraw"
  | (string & {});

export interface ZerionCallbackTransaction {
  type?: string;
  id?: string;
  attributes?: {
    operation_type?: ZerionOperationType;
    hash?: string;
    mined_at?: string;
    mined_at_block?: number;
    sent_from?: string;
    sent_to?: string;
    status?: "confirmed" | "failed" | (string & {});
    nonce?: number;
    fee?: { fungible_info?: ZerionFungibleInfo; quantity?: ZerionQuantity };
    transfers?: ZerionTransfer[];
    approvals?: ZerionApproval[];
    application_metadata?: ZerionApplicationMetadata;
    flags?: { is_trash?: boolean };
    /** Set on the second callback for a transaction dropped in a reorg. */
    deleted?: boolean;
  };
  relationships?: {
    chain?: { type?: string; id?: string } | { data?: { id?: string } };
    dapp?: { type?: string; id?: string } | { data?: { id?: string } };
  };
}

export interface ZerionCallbackPayload {
  data?: {
    id?: string;
    type?: string;
    attributes?: {
      timestamp?: string;
      callback_url?: string;
      /** The watched wallet this notification is about. */
      address?: string;
    };
    relationships?: {
      subscription?: { type?: string; id?: string };
    };
  };
  included?: ZerionCallbackTransaction[];
}

/** `relationships.chain` has been seen both flat and JSON:API-nested. */
export function chainIdOf(tx: ZerionCallbackTransaction): string | null {
  const rel = tx.relationships?.chain;
  if (!rel) return null;
  if ("id" in rel && typeof rel.id === "string") return rel.id;
  if ("data" in rel && rel.data && typeof rel.data.id === "string") {
    return rel.data.id;
  }
  return null;
}
