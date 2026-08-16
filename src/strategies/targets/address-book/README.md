# Address book — security-reviewed constants

**Spec:** `docs/defi-evm-protocol-expansion-spec.md` §11 Layer-1, §12 Q7, §11.6 #7.

## The rule

> **Singleton / router** contracts (Aave & forks' `Pool`, the Morpho singleton,
> Comet markets, the Curve address-provider, Pendle / Solidly / Balancer /
> Uniswap routers, LST entry contracts) **MUST** come from pinned, reviewed
> constants in this directory.
>
> **Per-vault / per-market** addresses may come from the protocol's own API —
> but only after passing Layer-1 identity (`asset()` / `baseToken()` /
> `underlying()` / `marketId` re-derivation) and provenance.

A third-party API response must never become a `tx.to` for a singleton kind.
That is the single highest-value defence in the expansion: the router-calldata
families (§6) hand us bytes we did not author, and pinning the router is what
stops a compromised or spoofed API from routing funds elsewhere.

## Chains are data; contract addresses are not

Which chains exist is read from the `Blockchain` table (`chain-directory.ts`) —
onboarding a chain is a seeded row, never a code change. **Deployment addresses
are the opposite:** they are the trust anchor, so they are code, reviewed like a
secret. A chain that is not in a family's book simply means that protocol is not
available there, and the resolver fails closed to the Manual deep-link path.

There is deliberately **no** env or API override for anything in here. An
address that can be changed without review is an address an attacker can change;
`STRATEGIES_CHAIN_ALIASES` exists for chain *names* precisely because a name
cannot become a `tx.to`.

## Changing anything here

1. Source the address from the protocol's **own** documentation or deployment
   registry, never a block-explorer search or an aggregator.
2. Cross-check it against a second official source.
3. Security-team sign-off on the diff (same bar as `constants/about.ts`).
4. Ship behind the family's feature flag, dark, and verify the on-chain
   validator accepts it on a fork before enabling.

Nothing here is trusted on its own: every entry still has to pass its Layer-1
validator (`validation.ts`) at resolve time. A wrong constant fails closed to
Manual rather than routing funds — that is by design, not a reason to be
careless.
