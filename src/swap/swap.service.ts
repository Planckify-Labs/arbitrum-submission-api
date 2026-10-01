/**
 * `SwapService` — same-chain swap orchestration.
 *
 * Spec: docs/swap-capability-spec.md §7.1.
 *
 * Forwards same-chain requests to BridgeService with topology guarantees
 * (fromChain === toChain).
 */

import { Injectable } from "@nestjs/common";
import { BridgeService, type BridgeQuoteResult } from "../bridge/bridge.service";
import type { BridgeStatus } from "../bridge/types";
import type { SwapQuoteDto, SwapStatusQueryDto } from "./dto/swap.dto";

@Injectable()
export class SwapService {
  constructor(private readonly bridgeService: BridgeService) {}

  quote(dto: SwapQuoteDto): Promise<BridgeQuoteResult> {
    return this.bridgeService.quote({
      fromChain: dto.chain,
      toChain: dto.chain,
      fromAsset: dto.fromAsset,
      toAsset: dto.toAsset,
      amountRaw: dto.amountRaw,
      fromAddress: dto.fromAddress,
      // A swap always pays the signer (spec §7.1 reason 3).
      toAddress: dto.fromAddress,
    });
  }

  status(query: SwapStatusQueryDto): Promise<BridgeStatus> {
    return this.bridgeService.status({
      provider: query.provider ?? "",
      fromChain: query.chain,
      toChain: query.chain,
      sourceTxHash: query.txHash,
    });
  }
}
