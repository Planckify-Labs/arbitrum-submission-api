import { Module } from "@nestjs/common";
import { TokensService } from "./tokens.service";
import { TokensController } from "./tokens.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";

@Module({
  imports: [PrismaModule, ValkeyModule],
  controllers: [TokensController],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
