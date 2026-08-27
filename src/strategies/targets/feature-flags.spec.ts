/**
 * Rollout + kill-switch flags (spec §8.6, §11 Layer 3).
 *
 * The property under test is not "does an env var parse" — it is that a
 * NON-EVM family can be turned off at all. Every Sui and Solana resolver used
 * to be registered unconditionally, so `DEFI_FAMILY_KILL_SWITCH` (the switch
 * the runbook tells an on-call engineer to use during an exploit) reached
 * exactly the EVM half of the catalogue and silently did nothing for the rest.
 */

import {
  familyEnabled,
  isFamilyKilled,
  nonEvmFamilyEnabled,
} from "./feature-flags";

const ENV_KEYS = [
  "FEATURE_DEFI_SUI_FAMILY_SCALLOP",
  "FEATURE_DEFI_SOLANA_FAMILY_KAMINO_LEND",
  "DEFI_FAMILY_KILL_SWITCH",
  "FEATURE_DEFI_EVM_TIER1",
];

describe("non-EVM family flags", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("defaults ON — these families are live, not staged", () => {
    expect(nonEvmFamilyEnabled("sui", "scallop")).toBe(true);
    expect(nonEvmFamilyEnabled("solana", "kamino-lend")).toBe(true);
  });

  it("turns one family off without touching the others", () => {
    process.env.FEATURE_DEFI_SUI_FAMILY_SCALLOP = "false";
    expect(nonEvmFamilyEnabled("sui", "scallop")).toBe(false);
    expect(nonEvmFamilyEnabled("sui", "navi")).toBe(true);
    expect(nonEvmFamilyEnabled("solana", "kamino-lend")).toBe(true);
  });

  it("derives the env name from the family key, punctuation included", () => {
    process.env.FEATURE_DEFI_SOLANA_FAMILY_KAMINO_LEND = "off";
    expect(nonEvmFamilyEnabled("solana", "kamino-lend")).toBe(false);
  });

  it("answers the SAME kill switch the EVM families answer to", () => {
    process.env.DEFI_FAMILY_KILL_SWITCH = "scallop, kamino-lend";
    // `isFamilyKilled` is what `registerNonEvm` consults alongside the flag —
    // this is the assertion that a Sui/Solana family is now reachable by the
    // incident switch at all.
    expect(isFamilyKilled("scallop")).toBe(true);
    expect(isFamilyKilled("kamino-lend")).toBe(true);
    expect(isFamilyKilled("navi")).toBe(false);
  });

  it("leaves the EVM tier gate alone (still default OFF, a review gate)", () => {
    expect(familyEnabled("tier1", "erc4626")).toBe(false);
  });
});
