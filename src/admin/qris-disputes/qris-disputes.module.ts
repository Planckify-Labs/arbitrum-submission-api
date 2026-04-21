import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { QrisDisputesController } from "./qris-disputes.controller";
import { QrisDisputesService } from "./qris-disputes.service";

/**
 * Admin module for the QRIS PAN dispute workflow (task 45).
 *
 * Kept under `src/admin/` so future ops-only surfaces (refund ops,
 * payout reconciliation overrides, etc) can co-locate without polluting
 * the merchant-facing lifecycle module.
 *
 * Only PrismaModule is wired — the service writes to
 * `MerchantQrisClaim`, `Merchant`, and `AdminAuditLog` all via the
 * shared Prisma client. The RolesGuard used by the controller is
 * registered globally in `auth.module.ts`, so no additional providers
 * are declared here.
 */
@Module({
  imports: [PrismaModule],
  controllers: [QrisDisputesController],
  providers: [QrisDisputesService],
  exports: [QrisDisputesService],
})
export class QrisDisputesModule {}
