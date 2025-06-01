import { Module } from "@nestjs/common";
import { VendorsService } from "./vendors.service";
import { VendorsController } from "./vendors.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [VendorsController],
  providers: [VendorsService],
  exports: [VendorsService],
})
export class VendorsModule {}
