import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Public } from "../decorators/public.decorator";
import { RegisterPushClientDto } from "./dto/register-client.dto";
import { RelaySignatureService } from "./relay-signature.service";
import {
  type RelayPushMessage,
  WalletConnectPushService,
} from "./walletconnect-push.service";

/**
 * WalletConnect push server (specs/servers/push). The project's Dashboard
 * "Push URL" is `https://<api>/walletconnect/push`; WalletConnect forwards
 * the wallet's device registration here and the relay POSTs deliveries
 * for clients whose socket is closed.
 *
 * Public by design: WalletConnect sends no API key. Registration carries
 * nothing sensitive (a relay client id and a push token that only our
 * Expo project can use); delivery is authenticated by the relay's
 * Ed25519 signature. Response shape follows the spec (`{ status }`).
 */
@ApiTags("walletconnect-push")
@Controller("walletconnect/push")
export class WalletConnectPushController {
  constructor(
    private readonly service: WalletConnectPushService,
    private readonly signatures: RelaySignatureService,
  ) {}

  @Get("health")
  @Public()
  @ApiOperation({ summary: "Push server health (WalletConnect probes this)." })
  health(): string {
    return "OK, takumipay-push v1";
  }

  @Post("clients")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Register a wallet install's relay client id with its push token.",
  })
  async register(
    @Body() dto: RegisterPushClientDto,
  ): Promise<{ status: "OK" }> {
    await this.service.register({
      clientId: dto.client_id,
      type: dto.type,
      token: dto.token,
      alwaysRaw: dto.always_raw ?? false,
    });
    return { status: "OK" };
  }

  @Delete("clients/:clientId")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Unregister a relay client id." })
  async unregister(
    @Param("clientId") clientId: string,
  ): Promise<{ status: "OK" }> {
    await this.service.unregister(clientId);
    return { status: "OK" };
  }

  @Post("clients/:clientId")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Relay delivery for an offline client (Ed25519-signed by the relay).",
  })
  async deliver(
    @Param("clientId") clientId: string,
    @Body() body: RelayPushMessage,
    @Headers("x-ed25519-signature") signature: string | undefined,
    @Headers("x-ed25519-timestamp") timestamp: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ status: "OK" }> {
    if (this.signatures.enabled) {
      const v = await this.signatures.verify({
        signatureHex: signature,
        timestamp,
        rawBody: req.rawBody,
      });
      if (!v.ok) {
        throw new UnauthorizedException({
          status: "FAILED",
          errors: [{ name: "signature", description: v.reason }],
        });
      }
    }
    await this.service.deliver(clientId, body ?? {});
    // The spec has no "not delivered" status; a missing device is not the
    // relay's problem, so it always sees OK once the signature checks out.
    return { status: "OK" };
  }
}
