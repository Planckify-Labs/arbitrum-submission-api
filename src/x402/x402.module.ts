import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ValkeyModule } from "../valkey/valkey.module";
import { X402SupportedService } from "./x402-supported.service";
import { X402HttpClient } from "./x402-http.client";
import { X402_HTTP_CLIENT } from "./x402.constants";

/**
 * Owns Circle's `GET /gateway/v1/x402/supported` cache (boot fetch + 12 h
 * refresh). Exported so `BlockchainsModule` can read the cache when it
 * enriches `GET /v1/blockchains` with per-chain x402 domain values
 * (spec §6.7, task 21). Spec ref: umkm-usdc-payout-spec.md §6.5.
 */
@Module({
  imports: [ConfigModule, ValkeyModule],
  providers: [
    X402SupportedService,
    X402HttpClient,
    { provide: X402_HTTP_CLIENT, useClass: X402HttpClient },
  ],
  exports: [X402SupportedService],
})
export class X402Module {}
