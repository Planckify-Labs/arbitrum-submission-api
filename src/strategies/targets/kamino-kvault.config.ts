/**
 * Kamino kvault ("Earn" share-vault) venue table — the BACKEND twin of the
 * mobile `services/defi/adapters/kaminoKvault.ts`. Keep the two in sync.
 *
 * DeFiLlama has NO dedicated "kamino-kvault" project: both known instances
 * surface under the `sentora` project (a multi-chain yield-aggregator brand
 * — it also has an unrelated Ethereum USDC pool that is NOT Kamino), matched
 * by `chain === "Solana"` and an EXACT `poolMeta` string. There is no public
 * "list kvaults" API (unlike Kamino Lend's `/v2/kamino-market`), so this is a
 * pinned table rather than a discovery join — same posture as the Solana LST
 * venue table.
 *
 * Both entries verified live 2026-08-23: `getAccountInfo` owner ==
 * `KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd` (the kvault program), and the
 * account's own decoded `tokenMint` field matches `mint` below exactly — see
 * the mobile adapter's header for the full byte-layout verification story.
 */

export interface KaminoKvaultVenue {
  /** Exact DeFiLlama `poolMeta` string this venue matches. */
  poolMeta: string;
  vault: string;
  mint: string;
  symbol: string;
}

export const KAMINO_KVAULT_VENUES: KaminoKvaultVenue[] = [
  {
    poolMeta: "Kamino Sentora PYUSD",
    vault: "A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK",
    mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    symbol: "PYUSD",
  },
  {
    poolMeta: "Kamino USDG Ethena",
    vault: "D1XVxx4ur7kiSgpuerUmoJXvZ3yEBFZWPx1uN7qBADFb",
    mint: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
    symbol: "USDG",
  },
];

export function kvaultVenueByPoolMeta(
  poolMeta: string | null | undefined,
): KaminoKvaultVenue | undefined {
  const needle = (poolMeta ?? "").trim().toLowerCase();
  return KAMINO_KVAULT_VENUES.find((v) => v.poolMeta.toLowerCase() === needle);
}
