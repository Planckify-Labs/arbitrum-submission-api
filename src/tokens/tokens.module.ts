import { Module } from "@nestjs/common";
import { TokensService } from "./tokens.service";
import { AlchemyTokenMetadataClient } from "./alchemy-token-metadata.client";
import { TokensController } from "./tokens.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";

@Module({
  imports: [PrismaModule, ValkeyModule],
  controllers: [TokensController],
  providers: [TokensService, AlchemyTokenMetadataClient],
  exports: [TokensService, AlchemyTokenMetadataClient],
})
export class TokensModule {}
