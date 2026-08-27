import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFI_ERROR_CODES } from "./errors/defi-error";
import { RecurringInvestService } from "./recurring-invest.service";

/**
 * DCA v1 acceptance checks (mobile-app docs/defi-quick-invest-spec.md
 * §12.8). The spec asks for these to be *verifiable, not aspirational* —
 * so they run in CI instead of living in a reviewer's head.
 *
 * Two of the three rules the feature depends on are structural properties
 * of the source, not observable behaviours, and a behavioural test cannot
 * see them: an EVM-only integration test passes just as happily against
 * code that lowercases a base58 Solana address. Reading the files is the
 * only way to assert "this bug is unrepresentable" rather than "this bug
 * did not happen on the input I tried".
 */

const SRC = __dirname;
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/** Comments explain the rules; only code can violate them. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVICE = stripComments(read("recurring-invest.service.ts"));
const PROCESSOR = stripComments(
  read("workers/recurring-invest-watcher.processor.ts"),
);
const DTO = stripComments(read("dto/recurring-invest.dto.ts"));

describe("DCA v1 — chain-agnostic by construction (§12.1a, §12.8)", () => {
  it.each([
    ["service", SERVICE],
    ["processor", PROCESSOR],
  ])("%s names no chain namespace", (_label, source) => {
    // The recurring layer has no legitimate reason to name a namespace: it
    // never signs, never reaches an RPC, and delegates the deposit to a
    // path that already routes by namespace through the walletKit registry.
    for (const namespace of ["eip155", "solana", "sui", "stellar"]) {
      expect(source).not.toContain(namespace);
    }
  });

  it("keys plans by CAIP-2, never by a numeric chain id", () => {
    expect(SERVICE).toContain("caip2Id");
    // A numeric `chainId` is an EVM-shaped key that degenerates to 0 for
    // Solana/Sui/Stellar.
    expect(SERVICE).not.toMatch(/\bchainId\s*[:=]\s*(dto|plan)\./);
  });

  it("adds no optional capability to any chain adapter", () => {
    // §12.8: if a reviewer finds one, the recurring layer has started
    // reaching into chain primitives it should be delegating instead.
    expect(SERVICE).not.toContain("WalletKitAdapter");
    expect(PROCESSOR).not.toContain("DefiAdapter");
  });
});

describe("DCA v1 — address handling is designed out (§12.3a, §12.8)", () => {
  it("Rule 1: no DTO carries a wallet-address field", () => {
    // A caller cannot supply a wrongly-cased address because a caller
    // cannot supply an address at all.
    expect(DTO).not.toMatch(/wallet/i);
    expect(DTO).not.toMatch(/address/i);
  });

  it("Rule 2: the recurring layer canonicalizes nothing", () => {
    // The JWT's address arrives canonical and is stored verbatim, so a
    // canonicalizer appearing here would mean an address is entering from
    // somewhere other than the JWT — Rule 1 being violated.
    for (const source of [SERVICE, PROCESSOR]) {
      expect(source).not.toContain("canonicalizeWalletAddress");
    }
  });

  it("Rule 2 backstop: no address is ever case-folded", () => {
    // Solana (base58) and Stellar (base32 StrKey) are case-SIGNIFICANT: a
    // folded row would never be found for its own owner, silently and with
    // no error. Asset symbols may be folded; addresses may not.
    for (const source of [SERVICE, PROCESSOR]) {
      const folds = source.match(/[A-Za-z0-9_.?]+\.to(Lower|Upper)Case\(\)/g);
      for (const fold of folds ?? []) {
        expect(fold.toLowerCase()).not.toContain("address");
        expect(fold.toLowerCase()).not.toContain("wallet");
      }
    }
  });

  it("Rule 3: the plan → push join passes the stored value through untouched", () => {
    // The watcher is the one place two independently-produced address
    // strings meet. `PushService` canonicalizes BOTH sides through the same
    // helper (registration and lookup), so the watcher must hand it the
    // plan's value verbatim rather than coercing one side to match.
    // Anchored so `plan.walletAddress.toLowerCase()` does NOT satisfy it —
    // a prefix match would, and that is exactly the drift this guards.
    expect(PROCESSOR).toMatch(/walletAddress:\s*plan\.walletAddress\s*,/);
  });
});

describe("DCA v1 — v1 creates no signing authority (§12.1, §13)", () => {
  it("the watcher only pushes; it never signs or submits", () => {
    for (const forbidden of [
      "signDelegation",
      "createDelegation",
      "encodeDelegations",
      "sendTransaction",
      "privateKey",
    ]) {
      expect(PROCESSOR).not.toContain(forbidden);
    }
    expect(PROCESSOR).toContain("sendToWallet");
  });

  it("keeps the executionMode forward-compat slot at 'reminder'", () => {
    // §12.7 Axis 2: one column today means v2 rows coexist with v1 rows
    // instead of forcing a migration. Deliberately NOT a dispatch registry
    // yet — with one implementation that is indirection without payoff.
    const schema = readFileSync(
      join(SRC, "..", "..", "prisma", "schema.prisma"),
      "utf8",
    );
    expect(schema).toMatch(/executionMode\s+String\s+@default\("reminder"\)/);
  });
});

describe("DCA v1 — cadence and skip semantics (§12.6)", () => {
  it("allows weekly or monthly only", () => {
    expect(DTO).toMatch(/ALLOWED_CADENCE_DAYS\s*=\s*\[7,\s*30\]/);
  });

  it("advances nextDueAt to a FUTURE slot, so missed cycles skip", () => {
    // Stacking would nag about money the user already implicitly declined,
    // and could produce a catch-up prompt for a doubled amount.
    expect(PROCESSOR).toContain("now.getTime() + step");
    expect(PROCESSOR).toContain("nextDueAt: { lte: now }");
  });

  it("claims a cycle atomically so a double cron fires one nudge", () => {
    expect(PROCESSOR).toContain("updateMany");
    expect(PROCESSOR).toContain("count === 1");
  });
});

describe("DCA v1 — service surface", () => {
  it("exposes exactly the CRUD the spec scopes", () => {
    const proto = RecurringInvestService.prototype as unknown as Record<
      string,
      unknown
    >;
    expect(typeof proto.createPlan).toBe("function");
    expect(typeof proto.listPlans).toBe("function");
    expect(typeof proto.updateStatus).toBe("function");
  });

  it("registers plan_not_found in the shared error vocabulary", () => {
    // Mirrored in mobile-app/services/defi/errors/defiErrors.ts — a code
    // missing on either side degrades silently to "unknown".
    expect(DEFI_ERROR_CODES).toContain("plan_not_found");
  });
});
