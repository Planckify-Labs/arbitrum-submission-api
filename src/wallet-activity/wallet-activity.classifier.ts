import { NotificationCategory } from "../push/notification-categories";
import { truncateAddress } from "../utils/address";
import {
  chainIdOf,
  type ZerionApproval,
  type ZerionCallbackTransaction,
  type ZerionFungibleInfo,
  type ZerionTransfer,
} from "./zerion-callback.types";

/**
 * Turns one decoded Zerion transaction, as seen from one watched wallet,
 * into the push we want to send — or `null` for "nothing worth ringing
 * for". Pure: no I/O, so every wording rule is unit-testable.
 *
 * Wording follows the app's existing pushes (amount first, plain
 * language, "You …"), and — unlike a raw transfer indexer — leans on
 * Zerion's `operation_type` so a swap is ONE "You swapped 86 MON for
 * 2.0909 AUSD" rather than a "sent" and a "received".
 */

export type ActivityKind =
  | "receive"
  | "send"
  | "trade"
  | "approve"
  | "revoke"
  | "claim"
  | "withdraw"
  | "deposit"
  | "mint"
  | "nft_receive"
  | "nft_send"
  | "nft_buy"
  | "nft_sell"
  | "failed"
  | "generic";

export interface FungibleAmount {
  symbol: string;
  name: string | null;
  /** Human amount, already divided by decimals. */
  amount: number;
  /** Raw base-unit amount as a decimal string, when Zerion gave one. */
  amountInt: string | null;
  decimals: number | null;
  /** Contract address on `chainId`; `null` = the chain's native asset. */
  contractAddress: string | null;
  iconUrl: string | null;
  counterparty: string | null;
}

export interface ActivityNotification {
  kind: ActivityKind;
  title: string;
  body: string;
  category: NotificationCategory;
  dedupeKey: string;
  data: Record<string, unknown>;
  /** Fungible in-transfers, for the Activity backfill + icon. */
  received: FungibleAmount[];
  sent: FungibleAmount[];
  /** The asset whose logo should ride on the push, if any. */
  iconAsset: FungibleAmount | null;
}

export interface ClassifyInput {
  tx: ZerionCallbackTransaction;
  /** The subscribed wallet the callback is about (`data.attributes.address`). */
  watchedAddress: string;
  /** Display name for a Zerion chain id ("monad" → "Monad"). */
  chainName: (zerionChainId: string) => string;
}

// Matches the "en-US" grouping used for points/currency everywhere else.
const AMOUNT_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

/** 2^255 or more base units is an "unlimited" ERC-20 approval. */
const UNLIMITED_APPROVAL_FLOAT = 1e30;

/**
 * The one identity both producers of a wallet-activity notification agree
 * on: the sender's app (transactions.service.ts) and the Zerion webhook.
 * Chain-less on purpose — a tx hash is unique per chain and, with EIP-155
 * / Solana signatures, across the chains we index; folding chain ids in
 * would only give the two producers something to disagree about.
 */
export function walletActivityDedupeKey(
  txHash: string,
  walletAddress: string,
): string {
  return `activity:${txHash.trim().toLowerCase()}:${walletAddress.trim().toLowerCase()}`;
}

export function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  if (amount !== 0 && Math.abs(amount) < 0.000001) return "<0.000001";
  return AMOUNT_FORMAT.format(amount);
}

function same(a: string | undefined | null, b: string): boolean {
  return !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function fungibleAmount(
  info: ZerionFungibleInfo | undefined,
  t: { quantity?: ZerionTransfer["quantity"] },
  chainId: string | null,
  counterparty: string | null,
): FungibleAmount | null {
  if (!info) return null;
  const symbol = (info.symbol ?? "").trim();
  if (!symbol) return null;
  const impl =
    chainId && info.implementations
      ? info.implementations.find((i) => i.chain_id === chainId)
      : undefined;
  const float =
    typeof t.quantity?.float === "number"
      ? t.quantity.float
      : t.quantity?.numeric
        ? Number(t.quantity.numeric)
        : NaN;
  return {
    symbol,
    name: info.name ?? null,
    amount: Number.isFinite(float) ? float : 0,
    amountInt: t.quantity?.int ?? null,
    decimals:
      typeof t.quantity?.decimals === "number"
        ? t.quantity.decimals
        : (impl?.decimals ?? null),
    contractAddress: impl?.address ?? null,
    iconUrl: info.icon?.url ?? null,
    counterparty,
  };
}

function listAmounts(items: FungibleAmount[]): string {
  const parts = items
    .slice(0, 3)
    .map((a) => `${formatAmount(a.amount)} ${a.symbol}`);
  const rest = items.length - parts.length;
  if (rest > 0) parts.push(`${rest} more`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "from Uniswap" when the counterparty is a known app, else "from 0x12…". */
function counterpartyLabel(
  address: string | null,
  appName: string | null,
  appContract: string | null,
): string | null {
  if (appName && (!address || !appContract || same(appContract, address))) {
    return appName;
  }
  if (address) return truncateAddress(address);
  return appName;
}

export function classifyActivity(
  input: ClassifyInput,
): ActivityNotification | null {
  const { tx, watchedAddress } = input;
  const attrs = tx.attributes ?? {};
  const hash = attrs.hash?.trim();
  if (!hash) return null;
  if (attrs.deleted) return null; // rollbacks are handled by the caller
  if (attrs.flags?.is_trash) return null;

  const zerionChainId = chainIdOf(tx);
  const chainLabel = zerionChainId ? input.chainName(zerionChainId) : null;
  const on = chainLabel ? ` on ${chainLabel}` : "";
  const app = attrs.application_metadata?.name?.trim() || null;
  const appContract = attrs.application_metadata?.contract_address ?? null;
  const op = attrs.operation_type ?? "execute";
  const dedupeKey = walletActivityDedupeKey(hash, watchedAddress);
  const baseData = {
    type: "wallet_activity",
    txHash: hash,
    chainId: zerionChainId,
    walletAddress: watchedAddress,
    operationType: op,
    ...(app ? { app } : {}),
  };

  // ── Failed: only the sender cares, and only that nothing moved. ──
  if (attrs.status === "failed") {
    if (!same(attrs.sent_from, watchedAddress)) return null;
    return {
      kind: "failed",
      title: "Transaction failed",
      body: `Your transaction${app ? ` with ${app}` : ""}${on} didn't go through. Nothing was moved; only the network fee was spent.`,
      category: NotificationCategory.wallet_activity,
      dedupeKey: `${dedupeKey}:failed`,
      data: { ...baseData, status: "failed" },
      received: [],
      sent: [],
      iconAsset: null,
    };
  }

  // ── Bucket transfers relative to the watched wallet. ──
  const transfers = attrs.transfers ?? [];
  const inF: FungibleAmount[] = [];
  const outF: FungibleAmount[] = [];
  const inNft: ZerionTransfer[] = [];
  const outNft: ZerionTransfer[] = [];
  for (const t of transfers) {
    // Prefer the explicit endpoints over `direction`: they are absolute,
    // while `direction` is relative to whichever wallet Zerion rendered for.
    const isIn = t.recipient
      ? same(t.recipient, watchedAddress)
      : t.direction === "in";
    const isOut = t.sender
      ? same(t.sender, watchedAddress)
      : t.direction === "out";
    if (isIn && isOut) continue; // self-transfer: nothing to announce
    if (!isIn && !isOut) continue;
    if (t.nft_info) {
      (isIn ? inNft : outNft).push(t);
      continue;
    }
    const amount = fungibleAmount(
      t.fungible_info,
      t,
      zerionChainId,
      isIn ? (t.sender ?? null) : (t.recipient ?? null),
    );
    if (!amount) continue;
    (isIn ? inF : outF).push(amount);
  }

  const common = {
    category: NotificationCategory.wallet_activity,
    data: baseData,
  };
  const build = (
    kind: ActivityKind,
    title: string,
    body: string,
    extra: Partial<ActivityNotification> = {},
  ): ActivityNotification => ({
    kind,
    title,
    body,
    dedupeKey,
    received: inF,
    sent: outF,
    iconAsset: inF[0] ?? outF[0] ?? null,
    ...common,
    ...extra,
  });

  // ── Approvals: security-relevant, their own category. ──
  if (op === "approve" || op === "revoke") {
    const approval: ZerionApproval | undefined = attrs.approvals?.[0];
    const asset = approval?.fungible_info?.symbol?.trim();
    const spender = counterpartyLabel(
      approval?.sender ?? attrs.sent_to ?? null,
      app,
      appContract,
    );
    if (op === "revoke") {
      return build(
        "revoke",
        "Approval revoked",
        `You revoked ${asset ? `${asset} ` : ""}access${spender ? ` for ${spender}` : ""}${on}.`,
        { category: NotificationCategory.approvals },
      );
    }
    const qty = approval?.quantity;
    const unlimited =
      (typeof qty?.float === "number" &&
        qty.float >= UNLIMITED_APPROVAL_FLOAT) ||
      (qty?.int ?? "").length >= 70;
    const amountWord = unlimited
      ? "unlimited"
      : typeof qty?.float === "number" && qty.float > 0
        ? formatAmount(qty.float)
        : "";
    const what = [amountWord, asset].filter(Boolean).join(" ") || "token";
    return build(
      "approve",
      "Token approval",
      `You approved ${what}${spender ? ` for ${spender}` : ""}${on}. Revoke it if you don't recognise this app.`,
      {
        category: NotificationCategory.approvals,
        data: { ...baseData, unlimited, asset: asset ?? null },
      },
    );
  }

  // ── NFTs ──
  if (inNft.length > 0 || outNft.length > 0) {
    const name = (t: ZerionTransfer) =>
      t.nft_info?.name?.trim() ||
      (t.nft_info?.token_id ? `NFT #${t.nft_info.token_id}` : "an NFT");
    if (inNft.length > 0 && outF.length > 0) {
      return build(
        "nft_buy",
        "NFT purchased",
        `You bought ${name(inNft[0])} for ${listAmounts(outF)}${on}.`,
      );
    }
    if (outNft.length > 0 && inF.length > 0) {
      return build(
        "nft_sell",
        "NFT sold",
        `You sold ${name(outNft[0])} for ${listAmounts(inF)}${on}.`,
      );
    }
    if (inNft.length > 0) {
      const from = counterpartyLabel(inNft[0].sender ?? null, app, appContract);
      return build(
        "nft_receive",
        "NFT received",
        `You received ${name(inNft[0])}${from ? ` from ${from}` : ""}${on}.`,
      );
    }
    const to = counterpartyLabel(outNft[0].recipient ?? null, app, appContract);
    return build(
      "nft_send",
      "NFT sent",
      `You sent ${name(outNft[0])}${to ? ` to ${to}` : ""}${on}.`,
    );
  }

  // ── Swaps: one notification, both legs. ──
  if (op === "trade" || (inF.length > 0 && outF.length > 0)) {
    if (inF.length > 0 && outF.length > 0) {
      return build(
        "trade",
        "Swap completed",
        `You swapped ${listAmounts(outF)} for ${listAmounts(inF)}${on}${app ? ` via ${app}` : ""}.`,
      );
    }
    // A trade Zerion could only see one leg of: fall through to the
    // single-direction wording below.
  }

  if (inF.length > 0 && outF.length === 0) {
    const from = counterpartyLabel(inF[0].counterparty, app, appContract);
    switch (op) {
      case "claim":
        return build(
          "claim",
          "Rewards claimed",
          `You claimed ${listAmounts(inF)}${from ? ` from ${from}` : ""}${on}.`,
        );
      case "withdraw":
        return build(
          "withdraw",
          "Withdrawal complete",
          `You withdrew ${listAmounts(inF)}${from ? ` from ${from}` : ""}${on}.`,
        );
      case "mint":
        return build(
          "mint",
          "Tokens minted",
          `You minted ${listAmounts(inF)}${on}.`,
        );
      default:
        return build(
          "receive",
          "Transfer Received",
          `You received ${listAmounts(inF)}${from ? ` from ${from}` : ""}${on}.`,
        );
    }
  }

  if (outF.length > 0 && inF.length === 0) {
    const to = counterpartyLabel(outF[0].counterparty, app, appContract);
    switch (op) {
      case "deposit":
        return build(
          "deposit",
          "Deposit confirmed",
          `You deposited ${listAmounts(outF)}${to ? ` into ${to}` : ""}${on}.`,
        );
      case "burn":
        return build(
          "generic",
          "Tokens burned",
          `You burned ${listAmounts(outF)}${on}.`,
        );
      default:
        return build(
          "send",
          "Transfer Sent",
          `You sent ${listAmounts(outF)}${to ? ` to ${to}` : ""}${on}.`,
        );
    }
  }

  // A contract call that moved nothing of ours (deploy, delegate, a vote…)
  // is not something to ring a phone for.
  return null;
}
