import { Injectable } from "@nestjs/common";
import type { IPaymentSettlementProvider } from "../settlement-provider.port";
import type { SettleArgs, SettleReceipt, PayerInput } from "../settlement.types";
import { SettlementRejectedError } from "../settlement.types";

/**
 * Nanopay (Circle x402) settlement adapter.
 *
 * Wraps the existing `IntentsService.submitNanopay` logic into the
 * settlement port interface. For v1 this is a thin shim -- the adapter
 * is the future extraction point for decoupling the Circle Gateway
 * settle call from the intent service.
 *
 * The orchestrator currently routes nanopay calls through the existing
 * code path; this adapter validates payer input shape and returns a
 * placeholder receipt. Full Circle Gateway delegation lands when the
 * existing `submitNanopay` is migrated behind this port.
 */
@Injectable()
export class NanopaySettlementProvider implements IPaymentSettlementProvider {
  readonly key = "nanopay" as const;

  async settle({ intent, payerInput }: SettleArgs): Promise<SettleReceipt> {
    if (payerInput.kind !== "signature") {
      throw new SettlementRejectedError(
        "PAYER_INPUT_WRONG_KIND",
        "Nanopay rail requires a signature, not a txHash",
      );
    }
    // NOTE: In the full implementation, this would call the Circle Gateway
    // settle endpoint. For now, the actual nanopay logic remains in
    // IntentsService.submitNanopay -- this adapter is the future extraction
    // point. The orchestrator currently routes nanopay calls through the
    // existing code path.
    return {
      settlementId: intent.id,
      status: "SETTLING",
    };
  }
}
