import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Merchant, PaymentIntent } from "@generated/prisma";
import {
  PAYMENT_SETTLEMENT_NANOPAY,
  PAYMENT_SETTLEMENT_ONCHAIN,
  type IPaymentSettlementProvider,
} from "./settlement-provider.port";
import type { PayerInput, SettleReceipt } from "./settlement.types";

/**
 * Settlement orchestrator -- resolves the correct settlement provider
 * from the intent's `path` field and delegates the settle call.
 *
 * Mirrors the `PayoutService.resolveProvider` factory pattern in
 * `payout/payout.service.ts`. Adding a new settlement rail is:
 *   1. New adapter class implementing `IPaymentSettlementProvider`.
 *   2. New Symbol token in `settlement-provider.port.ts`.
 *   3. New case arm in `resolveProvider` + constructor `@Inject` above.
 * No other files change.
 */
@Injectable()
export class SettlementOrchestratorService {
  private readonly logger = new Logger(SettlementOrchestratorService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(PAYMENT_SETTLEMENT_NANOPAY)
    private readonly nanopayProvider: IPaymentSettlementProvider,
    @Inject(PAYMENT_SETTLEMENT_ONCHAIN)
    private readonly onchainProvider: IPaymentSettlementProvider,
  ) { }

  resolveProvider(key: string): IPaymentSettlementProvider {
    switch (key) {
      case "nanopay":
        return this.nanopayProvider;
      case "takumipay":
      case "direct_arc":
        return this.onchainProvider;
      default: {
        const defaultRail = this.configService.get<string>(
          "PAYMENT_SETTLEMENT_RAIL",
          "nanopay",
        );
        return this.resolveProvider(defaultRail);
      }
    }
  }

  settleAndKickPayout(
    intent: PaymentIntent,
    merchant: Merchant,
    payerInput: PayerInput,
  ): Promise<SettleReceipt> {
    const provider = this.resolveProvider(intent.path);
    this.logger.log(
      `Settling intent ${intent.id} via ${provider.key} rail`,
    );
    return provider.settle({ intent, merchant, payerInput });
  }
}
