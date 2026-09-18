import { getAddress } from "viem";
// Type-only import — erased at compile time, so this pulls no auth.service
// runtime graph into this leaf util.
import type { AddressNamespace } from "../auth/auth.service";

/**
 * Truncates a wallet address for logs/notifications: first 8 + last 8
 * chars (e.g. "0x1a2b3c4d...9f8e7d6c"). Chain-agnostic — works the same
 * for EVM, Solana, and Stellar addresses since it's a plain string slice.
 */
export function truncateAddress(address: string): string {
  if (address.length <= 19) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

/**
 * Canonical storage/lookup form of a wallet address — the single source of
 * truth for "the same wallet always maps to the same string". This replaced
 * the `User.walletAddressLower` fold column: canonicalizing on write makes
 * `walletAddress @unique` a correct case-insensitive dedup key by itself.
 *
 * Case-sensitivity is a property of the ENCODING, not a per-call choice:
 *   - eip155 (0x-hex, 20 bytes): case-insignificant. Canonical = EIP-55
 *     checksummed (`getAddress`). Two differently-cased inputs collapse to
 *     the same checksummed output, so it doubles as the dedup key while
 *     staying the display-friendly form clients already receive.
 *   - sui (0x-hex, 32 bytes): case-insignificant → lowercase.
 *   - solana (base58) / stellar (base32 StrKey): case-SIGNIFICANT → verbatim.
 *     Lowercasing these produces a different, non-matching address.
 *
 * `namespace` is passed when known (login has it from the SIWx flow). When
 * omitted (e.g. the push registration path, which receives bare address
 * strings), it is inferred from the address shape.
 */
export function canonicalizeWalletAddress(
  address: string,
  namespace?: AddressNamespace,
): string {
  // Pasted/typed addresses (push registration, transfer recipients) can
  // carry stray whitespace; a leading space would otherwise make an EVM
  // address fail `getAddress`, fold to lowercase, and never match the
  // checksummed subscription row.
  address = address.trim();
  const ns = namespace ?? inferNamespace(address);
  if (ns === "eip155") {
    try {
      return getAddress(address);
    } catch {
      // Malformed-but-hex — still fold deterministically so writer and
      // reader agree instead of throwing on a value that already passed
      // upstream signature verification.
      return address.toLowerCase();
    }
  }
  if (ns === "sui") return address.toLowerCase();
  return address; // solana / stellar — case-significant
}

function inferNamespace(address: string): AddressNamespace {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return "eip155";
  if (/^0x[0-9a-fA-F]{64}$/.test(address)) return "sui";
  return "solana"; // base58 / base32 bucket — the verbatim branch
}
