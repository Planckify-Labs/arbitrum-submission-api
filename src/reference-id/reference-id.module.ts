import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ReferenceIdService } from "./reference-id.service";

@Module({
  imports: [PrismaModule],
  providers: [ReferenceIdService],
  exports: [ReferenceIdService],
})
export class ReferenceIdModule {}
