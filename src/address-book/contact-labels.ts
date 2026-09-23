import type { Prisma } from "@generated/prisma";
import { canonicalizeWalletAddress } from "../utils/address";

/** Longest contact name a notification body will carry before truncating. */
const MAX_LABEL_LENGTH = 32;

/** Maps a counterparty address to the recipient's own name for it, if any. */
export type ContactLabelLookup = (
  address: string | null | undefined,
) => string | null;

const NO_CONTACTS: ContactLabelLookup = () => null;

/**
 * Labels are free text typed into the address book. Flatten them to one
 * short line so a stray newline or a paragraph-long label cannot reshape a
 * notification body.
 */
function displayLabel(label: string): string | null {
  const flat = label
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length === 0) return null;
  return flat.length > MAX_LABEL_LENGTH
    ? `${flat.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`
    : flat;
}

/**
 * The address book of the wallet that owns `ownerWalletAddress`, as a
 * lookup from counterparty address to contact name. Used to write "from
 * Alice" instead of "from 0x9F83E8...dBB8E94F" in a push about that wallet.
 *
 * Address books are per wallet (each wallet is its own User, and the app
 * reads the active wallet's list), so this is the recipient wallet's own
 * list, never another user's: a name only appears if the person reading
 * the notification saved it themselves.
 *
 * Matching goes through `canonicalizeWalletAddress` on both sides, so EVM
 * and Sui entries match regardless of how they were typed, while Solana and
 * Stellar stay case-sensitive. Never throws: any failure means "no contact
 * names", and the caller falls back to the shortened address.
 *
 * Pass the plain client, not an open transaction's: a failed read inside
 * an interactive transaction aborts it in Postgres, and a contact name is
 * never worth rolling back the row the push is about.
 */
export async function loadContactLabels(
  db: Pick<Prisma.TransactionClient, "addressBook">,
  ownerWalletAddress: string,
): Promise<ContactLabelLookup> {
  try {
    const entries = await db.addressBook.findMany({
      where: {
        user: { walletAddress: canonicalizeWalletAddress(ownerWalletAddress) },
      },
      select: { address: true, label: true },
    });
    if (entries.length === 0) return NO_CONTACTS;

    const byAddress = new Map<string, string>();
    for (const entry of entries) {
      const label = displayLabel(entry.label);
      if (!label || !entry.address.trim()) continue;
      byAddress.set(canonicalizeWalletAddress(entry.address), label);
    }
    return (address) =>
      address?.trim()
        ? (byAddress.get(canonicalizeWalletAddress(address)) ?? null)
        : null;
  } catch {
    return NO_CONTACTS;
  }
}
