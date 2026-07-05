/**
 * Sui liquid-staking (LST) venue table — the BACKEND twin of the mobile
 * `services/defi/adapters/sui/lst.config.ts`. Keep the two in sync.
 *
 * These venues (Haedal / Volo / SpringSui / Aftermath) are NOT in DeFiLlama's
 * `/pools` yields feed, so the `SuiLstSource` synthesizes an opportunity row per
 * venue and the `SuiLstResolver` turns each back into a `{ kind: "sui-lst" }`
 * deposit target. Both key off this single table so a new LST is one row here,
 * not a branch in either place.
 *
 * The mobile adapter owns the pinned package/object ids + move-call shapes; the
 * backend only needs enough to (a) synthesize the pool row and (b) resolve the
 * target: the DeFiLlama protocol slug (also the pool `project` + TVL key), the
 * receipt coin type, and the LST symbol (the pool `poolMeta` label).
 */

/** Native SUI coin type, zero-padded to match DeFiLlama's Sui `underlyingTokens`. */
export const SUI_COIN_TYPE =
  "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";

export type SuiLstVenue = "haedal" | "volo" | "springsui" | "aftermath";

export interface SuiLstVenueInfo {
  venue: SuiLstVenue;
  /** DeFiLlama protocol slug — the synthesized pool `project` + `/tvl/{slug}` key. */
  defillamaSlug: string;
  /** Receipt (liquid-staking) coin type. */
  lstType: string;
  /** Receipt symbol (haSUI / vSUI / sSUI / afSUI) — the pool `poolMeta` label. */
  lstSymbol: string;
  /**
   * Whether the deposit executes in-app. All four do. Haedal + Volo hard
   * version-gate their shared objects, so their dry-run aborts (`assert_version`)
   * even though real execution succeeds — the mobile intent executor applies a
   * scoped bypass for that specific false-positive (see `simulationUnreliable` in
   * the mobile lst.config twin). Kept as a flag so a genuinely non-executable
   * venue could still resolve to `null` → Manual.
   */
  inAppDeposit: boolean;
}

export const SUI_LST_VENUES: SuiLstVenueInfo[] = [
  {
    venue: "haedal",
    defillamaSlug: "haedal-protocol",
    lstType:
      "0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI",
    lstSymbol: "haSUI",
    inAppDeposit: true,
  },
  {
    venue: "volo",
    defillamaSlug: "volo-lst",
    lstType:
      "0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT",
    lstSymbol: "vSUI",
    inAppDeposit: true,
  },
  {
    venue: "springsui",
    defillamaSlug: "springsui",
    lstType:
      "0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI",
    lstSymbol: "sSUI",
    inAppDeposit: true,
  },
  {
    venue: "aftermath",
    defillamaSlug: "aftermath-afsui",
    lstType:
      "0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI",
    lstSymbol: "afSUI",
    inAppDeposit: true,
  },
];

/** Deterministic, stable pool id for a venue's synthesized opportunity row. */
export function lstPoolId(venue: SuiLstVenue): string {
  return `sui-lst-${venue}`;
}

/** Look up a venue by its DeFiLlama project slug (case-insensitive). */
export function lstVenueBySlug(project: string): SuiLstVenueInfo | undefined {
  const p = project.toLowerCase();
  return SUI_LST_VENUES.find((v) => v.defillamaSlug.toLowerCase() === p);
}
