/**
 * `SwapModule` — same-chain swap module.
 *
 * Spec: docs/swap-capability-spec.md §7.1.
 */

import { Module } from "@nestjs/common";
import { BridgeModule } from "../bridge/bridge.module";
import { SwapController } from "./swap.controller";
import { SwapService } from "./swap.service";

@Module({
  imports: [BridgeModule],
  controllers: [SwapController],
  providers: [SwapService],
  exports: [SwapService],
})
export class SwapModule {}
