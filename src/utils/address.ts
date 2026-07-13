/**
 * Truncates a wallet address for logs/notifications: first 8 + last 8
 * chars (e.g. "0x1a2b3c4d...9f8e7d6c"). Chain-agnostic — works the same
 * for EVM, Solana, and Stellar addresses since it's a plain string slice.
 */
export function truncateAddress(address: string): string {
  if (address.length <= 19) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}
