import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../prisma/prisma.module";
import { BlockchainVerificationModule } from "../../blockchain-verification/blockchain-verification.module";
import {
  PAYMENT_SETTLEMENT_NANOPAY,
  PAYMENT_SETTLEMENT_ONCHAIN,
} from "./settlement-provider.port";
import { NanopaySettlementProvider } from "./providers/nanopay.settlement.provider";
import { OnchainSettlementProvider } from "./providers/onchain.settlement.provider";
import { SettlementOrchestratorService } from "./settlement-orchestrator.service";

@Module({
  imports: [ConfigModule, PrismaModule, BlockchainVerificationModule],
  providers: [
    { provide: PAYMENT_SETTLEMENT_NANOPAY, useClass: NanopaySettlementProvider },
    { provide: PAYMENT_SETTLEMENT_ONCHAIN, useClass: OnchainSettlementProvider },
    SettlementOrchestratorService,
  ],
  exports: [SettlementOrchestratorService],
})
export class SettlementModule {}
