import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PushModule } from "../push/push.module";
import { RelaySignatureService } from "./relay-signature.service";
import { WalletConnectPushController } from "./walletconnect-push.controller";
import { WalletConnectPushService } from "./walletconnect-push.service";

@Module({
  imports: [PrismaModule, PushModule],
  controllers: [WalletConnectPushController],
  providers: [WalletConnectPushService, RelaySignatureService],
})
export class WalletConnectPushModule {}
