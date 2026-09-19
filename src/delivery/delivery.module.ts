import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { DeliveryParserService } from "./delivery-parser.service";

@Module({
  imports: [PrismaModule],
  providers: [DeliveryParserService],
  exports: [DeliveryParserService],
})
export class DeliveryModule {}
