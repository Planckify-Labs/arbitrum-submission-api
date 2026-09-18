import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PushModule } from "../push/push.module";
import { TokensModule } from "../tokens/tokens.module";
import { TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";

@Module({
  imports: [PrismaModule, PushModule, TokensModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
