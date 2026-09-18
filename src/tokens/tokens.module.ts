import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";
import { AlchemyTokenMetadataClient } from "./alchemy-token-metadata.client";
import { TokenIconService } from "./token-icon.service";
import { TokensController } from "./tokens.controller";
import { TokensService } from "./tokens.service";

@Module({
  imports: [PrismaModule, ValkeyModule],
  controllers: [TokensController],
  providers: [TokensService, AlchemyTokenMetadataClient, TokenIconService],
  exports: [TokensService, AlchemyTokenMetadataClient, TokenIconService],
})
export class TokensModule {}
