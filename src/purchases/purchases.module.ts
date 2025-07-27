import { Module } from "@nestjs/common";
import { PurchasesService } from "./purchases.service";
import { PurchasesController } from "./purchases.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { VendorAPIModule } from "../providers/vendor-api/vendor-api.module";
import { ProductsModule } from "../products/products.module";
import { ReferenceIdModule } from "../reference-id/reference-id.module";

@Module({
  imports: [PrismaModule, VendorAPIModule, ProductsModule, ReferenceIdModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
