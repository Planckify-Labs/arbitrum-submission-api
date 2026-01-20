import { Module } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { ProductsController } from "./products.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { ProductInputValidatorService } from "./services/product-input-validator.service";
import { VendorAPIModule } from "../providers/vendor-api/vendor-api.module";
import { ValkeyModule } from "../valkey/valkey.module";

@Module({
  imports: [PrismaModule, VendorAPIModule, ValkeyModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductInputValidatorService],
  exports: [ProductsService, ProductInputValidatorService],
})
export class ProductsModule {}
