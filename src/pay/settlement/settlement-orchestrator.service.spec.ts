import type { ConfigService } from "@nestjs/config";
import type { IPaymentSettlementProvider } from "./settlement-provider.port";
import { SettlementOrchestratorService } from "./settlement-orchestrator.service";

/**
 * Selector tests for SettlementOrchestratorService (task 23).
 *
 * Follows the `payout.service.resolve-provider.spec.ts` pattern:
 * inject two distinct adapter stubs, assert the routing decision
 * for each key, and verify the non-selected adapter is never touched.
 *
 * Space-docking rule: `resolveProvider` is the only switch in the
 * codebase that reads the settlement rail key. A regression here
 * silently routes onchain-configured intents through the nanopay
 * adapter (or vice versa).
 */

function makeNanopayAdapter(): IPaymentSettlementProvider {
  return {
    key: "nanopay",
    settle: jest.fn(async () => ({
      settlementId: "nanopay_result",
      status: "SETTLING" as const,
    })),
  };
}

function makeOnchainAdapter(): IPaymentSettlementProvider {
  return {
    key: "onchain",
    settle: jest.fn(async () => ({
      settlementId: "onchain_result",
      status: "SETTLED" as const,
      txHash: "0xabc",
    })),
  };
}

function configStub(
  defaultRail = "nanopay",
): Pick<ConfigService, "get"> {
  return {
    get: jest.fn((k: string, defaultVal?: any) => {
      if (k === "PAYMENT_SETTLEMENT_RAIL") return defaultRail;
      return defaultVal;
    }),
  } as any;
}

function build(defaultRail = "nanopay") {
  const nanopay = makeNanopayAdapter();
  const onchain = makeOnchainAdapter();
  const config = configStub(defaultRail);
  const svc = new SettlementOrchestratorService(
    config as any,
    nanopay,
    onchain,
  );
  return { svc, nanopay, onchain, config };
}

describe("SettlementOrchestratorService.resolveProvider routing", () => {
  it('resolveProvider("nanopay") returns the nanopay adapter', () => {
    const { svc, nanopay, onchain } = build();
    const provider = svc.resolveProvider("nanopay");
    expect(provider).toBe(nanopay);
    expect(provider.key).toBe("nanopay");
  });

  it('resolveProvider("onchain") returns the onchain adapter', () => {
    const { svc, onchain } = build();
    const provider = svc.resolveProvider("onchain");
    expect(provider).toBe(onchain);
    expect(provider.key).toBe("onchain");
  });

  it('resolveProvider("direct_arc") returns the onchain adapter (alias)', () => {
    const { svc, onchain } = build();
    const provider = svc.resolveProvider("direct_arc");
    expect(provider).toBe(onchain);
    expect(provider.key).toBe("onchain");
  });

  it("resolveProvider(unknown) falls back to the env default (nanopay)", () => {
    const { svc, nanopay } = build("nanopay");
    const provider = svc.resolveProvider("some_future_rail");
    expect(provider).toBe(nanopay);
    expect(provider.key).toBe("nanopay");
  });

  it("resolveProvider(unknown) falls back to onchain when env default is onchain", () => {
    const { svc, onchain } = build("onchain");
    const provider = svc.resolveProvider("unknown_rail");
    expect(provider).toBe(onchain);
    expect(provider.key).toBe("onchain");
  });
});

describe("SettlementOrchestratorService.settleAndKickPayout delegation", () => {
  it("delegates to the correct provider based on intent.path", async () => {
    const { svc, nanopay, onchain } = build();
    const intent = { id: "pi_01", path: "direct_arc" } as any;
    const merchant = { id: "mch_01" } as any;
    const payerInput = { kind: "txHash" as const, txHash: "0xabc", chainId: 1 };

    const result = await svc.settleAndKickPayout(intent, merchant, payerInput);

    expect(result.settlementId).toBe("onchain_result");
    expect(onchain.settle).toHaveBeenCalledTimes(1);
    expect(nanopay.settle).not.toHaveBeenCalled();
    expect(onchain.settle).toHaveBeenCalledWith({
      intent,
      merchant,
      payerInput,
    });
  });

  it("delegates nanopay-path intents to the nanopay adapter", async () => {
    const { svc, nanopay, onchain } = build();
    const intent = { id: "pi_02", path: "nanopay" } as any;
    const merchant = { id: "mch_01" } as any;
    const payerInput = { kind: "signature" as const, signature: "0xsig" };

    const result = await svc.settleAndKickPayout(intent, merchant, payerInput);

    expect(result.settlementId).toBe("nanopay_result");
    expect(nanopay.settle).toHaveBeenCalledTimes(1);
    expect(onchain.settle).not.toHaveBeenCalled();
  });
});
