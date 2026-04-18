import type { AddressNamespace } from "./auth.service";

/**
 * Namespace-aware equality for wallet addresses.
 *
 * EVM (eip155) is case-insensitive on-chain — compare lowercased.
 * Solana base58 is case-sensitive — compare verbatim.
 *
 * Pass `namespace` when known (e.g. from JWT `addressNamespace`). When it's
 * not known, the function infers from address shape: `0x…` hex is EVM,
 * everything else is Solana.
 */
export function addressesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
  namespace?: AddressNamespace,
): boolean {
  if (!a || !b) return false;
  const ns: AddressNamespace =
    namespace ?? (/^0x[a-fA-F0-9]{40}$/.test(a) ? "eip155" : "solana");
  return ns === "solana" ? a === b : a.toLowerCase() === b.toLowerCase();
}

/**
 * Normalize an address for use as a lookup / cache key.
 * EVM → lowercase; Solana → verbatim.
 */
export function normalizeAddressForKey(
  address: string,
  namespace: AddressNamespace,
): string {
  return namespace === "eip155" ? address.toLowerCase() : address;
}
