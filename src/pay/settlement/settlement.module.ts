import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../prisma/prisma.module";
import { BlockchainVerificationModule } from "../../blockchain-verification/blockchain-verification.module";
import {
  PAYMENT_SETTLEMENT_NANOPAY,
  PAYMENT_SETTLEMENT_ONCHAIN,
} from "./settlement-provider.port";
import { NanopaySettlementProvider } from "./providers/nanopay.settlement.provider";
import { SettlementOrchestratorService } from "./settlement-orchestrator.service";

// Placeholder for Phase 4 -- replaced by real OnchainSettlementProvider in task 18
const OnchainSettlementStub = {
  provide: PAYMENT_SETTLEMENT_ONCHAIN,
  useValue: {
    key: "onchain",
    async settle() {
      throw new Error("Onchain settlement provider not yet implemented (task 18)");
    },
  },
};

@Module({
  imports: [ConfigModule, PrismaModule, BlockchainVerificationModule],
  providers: [
    { provide: PAYMENT_SETTLEMENT_NANOPAY, useClass: NanopaySettlementProvider },
    OnchainSettlementStub,
    SettlementOrchestratorService,
  ],
  exports: [SettlementOrchestratorService],
})
export class SettlementModule {}
