/**
 * Outbound-network preamble. **Import this before anything that can do a DNS
 * lookup** — it is side-effecting on purpose, and it is load-bearing.
 *
 * Every DeFi discovery endpoint we depend on (api.llama.fi, yields.llama.fi,
 * api.morpho.org, ydaemon.yearn.fi) is dual-stack or is served a synthesised
 * AAAA by a DNS64 resolver. On a host whose IPv6 egress is missing or
 * blackholed, Node's defaults turn that into an intermittent
 * `TypeError: fetch failed` that every resolver swallows as "no candidate" —
 * so the pool degrades to Manual and **nothing anywhere says why**.
 *
 * Two separate defaults have to be changed; neither one alone is enough.
 *
 * 1. `setDefaultResultOrder("ipv4first")` — Node ≥17 returns lookups
 *    `verbatim`, which can surface the IPv6 address first. This only changes
 *    the ORDER, so it is necessary but not sufficient. Equivalent to
 *    `NODE_OPTIONS=--dns-result-order=ipv4first`.
 *
 * 2. `setDefaultAutoSelectFamily(false)` — Node 20 made happy-eyeballs
 *    default-true, so `fetch` RACES an IPv4 and an IPv6 connect regardless of
 *    the lookup order. Two ways that race is lost even though IPv4 was
 *    reachable the whole time:
 *      - blackholed IPv6 hangs rather than erroring, and takes the request
 *        down with it;
 *      - the per-attempt budget (`autoSelectFamilyAttemptTimeout`, default
 *        **250ms**) is shorter than a slow-but-fine IPv4 handshake, so the
 *        good address is abandoned mid-flight.
 *    Equivalent to `--no-network-family-autoselection`.
 *
 * Measured 2026-08-21 against `ydaemon.yearn.fi`, which a DNS64 resolver
 * answers with both `34.21.69.240` and the NAT64 form `64:ff9b::2215:45f0`:
 *
 *   raw IPv4 connect                      → OK in 364ms   (> the 250ms budget)
 *   IPv6 NAT64 connect                    → ENETUNREACH, immediately
 *   fetch(), Node defaults                → TypeError: fetch failed
 *   fetch(), autoSelectFamily off         → HTTP 200, 200 vaults, 1821ms
 *   curl (IPv4)                           → HTTP 200, 723KB
 *
 * That `curl` line is why this keeps getting misdiagnosed as the remote API
 * being down: curl works, so the endpoint looks healthy from a shell.
 *
 * Earlier measurement on the same stack: the scoring worker resolved 48 EVM
 * deposit targets while the dry run, run with these settings, resolved 217
 * against identical chain state.
 *
 * **Every entrypoint that makes outbound calls must import this** — the API
 * server, the dry-run script, and the jest processes that run the drift
 * checks. A drift check without it reports "this family has gone dark" for a
 * family that is perfectly fine (runbook §11.5).
 */

import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";

setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);
