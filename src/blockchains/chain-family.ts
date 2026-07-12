/**
 * `Blockchain.type` is a plain string, not a Postgres enum, so extending to
 * a chain within an existing family (a new EVM chain, Aptos once we have a
 * second MOVE_VM chain, ...) never needs a migration — only a new
 * `Blockchain` row. A genuinely new family needs a one-line addition here
 * plus a data backfill, still no schema change.
 *
 * The trade: nothing at the DB layer stops a bad value (a hand-run SQL
 * UPDATE bypassing this codebase, a typo) from landing in the column — a
 * real Postgres enum would catch that, this won't. Every read site MUST go
 * through `assertChainFamily` so a bad value fails loudly at the point of
 * use instead of silently misrouting (e.g. a non-EVM chain with a garbage
 * `type` falling through to Solana's verification logic).
 */
export const CHAIN_FAMILIES = ["EVM", "SVM", "MOVE_VM", "STELLAR"] as const;

export type ChainFamily = (typeof CHAIN_FAMILIES)[number];

export function assertChainFamily(value: string, context: string): ChainFamily {
  if (!(CHAIN_FAMILIES as readonly string[]).includes(value)) {
    throw new Error(
      `Unrecognized chain family "${value}" for ${context}. Expected one of: ${CHAIN_FAMILIES.join(", ")}`,
    );
  }
  return value as ChainFamily;
}
