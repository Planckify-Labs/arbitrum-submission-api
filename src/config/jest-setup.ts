/**
 * Jest process bootstrap. Two things every suite needs, neither of which jest
 * does on its own.
 *
 * 1. **`.env`**. Jest has no `--env-file`, so a spec that reaches the network
 *    saw no credentials at all. That is why the address-book drift check
 *    reported "checked something: 0" — not a missing endpoint, a missing
 *    environment. Loading it here is what makes `DRIFT_CHECKS=1 npx jest …`
 *    work straight from a clone (runbook §11.5).
 *
 *    `process.loadEnvFile()` does NOT work here, and fails silently when you
 *    try: it is a native binding that writes to the real process env, while
 *    jest hands each test file a COPY of `process.env`. Nothing throws, the
 *    variables simply are not there. So the file is parsed and assigned onto
 *    the `process.env` the sandbox actually sees.
 *
 * 2. **The outbound-network defaults**, for the reason spelled out in
 *    `egress-network.ts`: without them a healthy upstream intermittently reads
 *    as dead, and a drift check that says "this family has gone dark" about a
 *    family that is fine is worse than no drift check at all.
 *
 * Nothing here overrides a variable already set in the shell — CI and ad-hoc
 * `FOO=1 npx jest` keep precedence.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

import "./egress-network";

try {
  const parsed = parseEnv(
    readFileSync(resolve(__dirname, "../../.env"), "utf8"),
  ) as Record<string, string>;
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // No .env, or an unreadable one. Specs that need a key check for it and
  // skip, so this must not take the suite down.
}
