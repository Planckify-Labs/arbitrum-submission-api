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
3. **Confirm the label matches.** An address can be real, official, and still be
   the wrong contract — a past review found a genuine Origin address, published
   in Origin's own registry under a `// OGV` comment, pinned here as a vault.
4. Security-team sign-off on the diff (same bar as `constants/about.ts`).
5. Ship behind the family's feature flag, dark, and verify the on-chain
   validator accepts it on a fork before enabling.

Procedure, evidence format and the standing sign-off record:
`mobile-app/docs/runbooks/defi-address-book-security-signoff.md`.

> **Do not lean on `address-book.spec.ts` to catch a typo.** It asserts every
> address is valid EIP-55, which only detects corruption of an address that was
> already correct. A mistyped address that is then re-checksummed produces a
> *valid* checksum and passes the guard — measured, not theorised (2026-08-21).
>
> Nor does a green fork test help: it proves the calldata is well-formed for
> whatever address it was handed. A wrong pin here fails closed to Manual, which
> is safe but silent, and reads exactly like "that pool was never ours".

Nothing here is trusted on its own: every entry still has to pass its Layer-1
validator (`validation.ts`) at resolve time. A wrong constant fails closed to
Manual rather than routing funds — that is by design, not a reason to be
careless.

## `oracles.ts` is a book of *inputs*, not destinations

Everything else here answers "where may funds go?". `oracles.ts` answers a
different question — "whose price are we lending behind?" — and it is pinned
under the same rule for the same reason: a supplier to a Morpho Blue market
carries that market's bad-debt risk, so its oracle decides whether we route
funds there at all (§12 Q6).

Two entries per chain, and they only work as a pair:

- `MORPHO_CHAINLINK_ORACLE_FACTORIES` proves an oracle's **code** is Morpho's
  audited implementation.
- `CHAINLINK_FEEDS` proves that code's **inputs** are feeds we reviewed.

Neither is sufficient alone. `createMorphoChainlinkOracleV2` is permissionless,
so anyone can mint a genuine factory oracle wired to a price contract they
control; conversely a reviewed feed proves nothing about a contract that merely
claims to read it. Both are re-read from the chain at resolve time — the point
of the check is the wiring, so taking the wiring from an API would be no check
at all.

Adding a feed admits **every** market that reads it, on every chain in that
entry. That is the leverage that makes this list maintainable, and the reason a
line here needs the same sign-off as a `tx.to`.
