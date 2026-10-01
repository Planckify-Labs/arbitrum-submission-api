/**
 * `Blockchain.chainId` -> Alchemy's own network-slug vocabulary.
 *
 * Third-party naming, not derivable from `chain-directory.ts` (which only
 * knows our own chain rows) — same "address-book posture" as
 * `AaveV3Deployments` / `aaveViemChainFor` in mobile-app's
 * `services/defi/positions/reader.ts`. Extend as new EVM chains are
 * onboarded.
 *
 * Lives here rather than inside one client because both the Prices API and
 * the Token API speak this vocabulary, and a map owned by whichever client
 * happened to need it first is a map the second one imports across a module
 * boundary for no reason.
 */
const ALCHEMY_NETWORK_BY_CHAIN_ID: Record<number, string> = {
  1: "eth-mainnet",
  10: "opt-mainnet",
  56: "bnb-mainnet",
  137: "polygon-mainnet",
  8453: "base-mainnet",
  42161: "arb-mainnet",
  43114: "avax-mainnet",
  5042: "arc-mainnet",
  11155111: "eth-sepolia",
  84532: "base-sepolia",
  421614: "arb-sepolia",
};

/**
 * `null` for any chain Alchemy does not serve, which callers must treat as a
 * normal outcome rather than an error.
 *
 * Coverage is a property of the vendor, not of the app: TakumiPay onboards
 * chains from the Blockchain table, and Alchemy will always trail that list.
 * So every consumer degrades instead of failing — the approval sheet falls
 * back to reading `decimals()` from the token contract through the wallet's
 * own pinned RPC, and prices resolve to null. Adding a chain here is a pure
 * enhancement; forgetting to add one costs an icon, never correctness.
 */
export function alchemyNetworkForChainId(chainId: number): string | null {
  return ALCHEMY_NETWORK_BY_CHAIN_ID[chainId] ?? null;
}
