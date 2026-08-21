import { Prisma } from "@generated/prisma";
import {
  decideScoreWrite,
  decideTargetWrite,
} from "./score-opportunities.processor";

const TARGET = { kind: "erc4626", vault: "0xabc", asset: "0xdef" };
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);

describe("decideTargetWrite — a flaky RPC must not badge a pool Manual", () => {
  it("writes a freshly resolved target and stamps it", () => {
    const d = decideTargetWrite(TARGET, null, NOW);
    expect(d.target).toBe(TARGET);
    expect(d.resolvedAt).toEqual(new Date(NOW));
    expect(d.keptPrevious).toBe(false);
  });

  it("keeps a recently validated target when this pass resolves nothing", () => {
    // The measured bug: four Aave v3 reserves that resolve in the dry run were
    // persisted as NULL by the worker, flipping their badge to Manual.
    const d = decideTargetWrite(
      null,
      {
        depositTarget: TARGET,
        targetResolvedAt: new Date(NOW - 2 * HOUR),
      },
      NOW,
    );
    expect(d.target).toBe(TARGET);
    expect(d.keptPrevious).toBe(true);
  });

  it("does NOT extend the window on repeated failures", () => {
    // resolvedAt must stay pinned to the last SUCCESSFUL validation, otherwise
    // a pool that never validates again keeps its badge forever.
    const lastGood = new Date(NOW - 2 * HOUR);
    const d = decideTargetWrite(
      null,
      {
        depositTarget: TARGET,
        targetResolvedAt: lastGood,
      },
      NOW,
    );
    expect(d.resolvedAt).toEqual(lastGood);
  });

  it("clears a target that has failed for longer than the grace window", () => {
    const d = decideTargetWrite(
      null,
      {
        depositTarget: TARGET,
        targetResolvedAt: new Date(NOW - 25 * HOUR),
      },
      NOW,
    );
    expect(d.target).toBe(Prisma.DbNull);
    expect(d.resolvedAt).toBeNull();
    expect(d.keptPrevious).toBe(false);
  });

  it("stays Manual when there was never a target to keep", () => {
    // A genuine refusal must still be a refusal — the grace window only
    // protects something that was previously PROVEN on chain.
    expect(decideTargetWrite(null, null, NOW).target).toBe(Prisma.DbNull);
    expect(
      decideTargetWrite(
        null,
        { depositTarget: null, targetResolvedAt: new Date(NOW) },
        NOW,
      ).target,
    ).toBe(Prisma.DbNull);
  });

  it("never keeps a target whose validation time is unknown", () => {
    // targetResolvedAt null means "never validated"; the grace window has no
    // anchor, so trusting it would be trusting an unbounded age.
    const d = decideTargetWrite(
      null,
      {
        depositTarget: TARGET,
        targetResolvedAt: null,
      },
      NOW,
    );
    expect(d.target).toBe(Prisma.DbNull);
  });
});

describe("decideScoreWrite — a failed metadata lookup must not re-tier a pool", () => {
  const FRESH = { score: 55, tier: "aggressive" };
  const PREV = { score: 78, tier: "balanced" };

  it("uses the fresh score when metadata was read successfully", () => {
    const d = decideScoreWrite(FRESH, false, PREV);
    expect(d).toEqual({ ...FRESH, keptPrevious: false });
  });

  it("keeps the previous score and tier when metadata was degraded", () => {
    // The measured bug: as api.llama.fi lookups timed out, `auditCount: 0`
    // dropped protocolSafety 85 → 40, the tier moved, and pools fell out of the
    // tier-filtered list. EVM rows went 169 → 141 with no protocol change.
    const d = decideScoreWrite(FRESH, true, PREV);
    expect(d).toEqual({ score: 78, tier: "balanced", keptPrevious: true });
  });

  it("still scores a brand-new pool when metadata is degraded", () => {
    // Nothing to keep, so a conservative score is better than no row at all.
    const d = decideScoreWrite(FRESH, true, null);
    expect(d).toEqual({ ...FRESH, keptPrevious: false });
  });
});
