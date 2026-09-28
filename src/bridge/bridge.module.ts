/**
 * Bridge module.
 *
 * Spec: docs/bridge-capability-spec.md §5.2, §5.4.
 *
 * Registration is the ONLY place that knows the adapter set. Adding a
 * provider (Bitcoin, a future Stellar-native bridge) is one `register`
 * call here plus the adapter file — no enum edit, no branch in shared
 * code, and nothing downstream learns a namespace string.
 */

import { Module, type OnModuleInit } from "@nestjs/common";
import { BridgeController } from "./bridge.controller";
import { BridgeService } from "./bridge.service";
import { CctpStellarAdapter } from "./providers/cctp-stellar.adapter";
import { CircleAppKitClient } from "./providers/circle/app-kit.client";
import { CircleCctpAdapter } from "./providers/circle/circle-cctp.adapter";
import { CircleCctpxAdapter } from "./providers/circle/circle-cctpx.adapter";
import { LifiBridgeAdapter } from "./providers/lifi.adapter";
import { TowerSwapAdapter } from "./providers/tower.adapter";
import { registerBridgeAdapter } from "./registry";

@Module({
  controllers: [BridgeController],
  providers: [
    BridgeService,
    CircleAppKitClient,
    LifiBridgeAdapter,
    CircleCctpAdapter,
    CircleCctpxAdapter,
    CctpStellarAdapter,
    TowerSwapAdapter,
  ],
  exports: [BridgeService],
})
export class BridgeModule implements OnModuleInit {
  constructor(
    private readonly lifi: LifiBridgeAdapter,
    private readonly circleCctp: CircleCctpAdapter,
    private readonly circleCctpx: CircleCctpxAdapter,
    private readonly cctpStellar: CctpStellarAdapter,
    private readonly tower: TowerSwapAdapter,
  ) {}

  onModuleInit(): void {
    // `lifi` — any asset, 72 chains, EVM + Solana + Sui. Misses Stellar.
    registerBridgeAdapter(this.lifi);

    // `circle-cctp` — USDC over CCTP V2, built on Arc App Kit (§5.4).
    // Declares `supportsAsset`, so the registry sorts it AHEAD of LI.FI
    // for USDC: Standard CCTP is free, LI.FI charges 25 bps on top, and
    // LI.FI serves no route on Arc mainnet at all. LI.FI remains the
    // fallback whenever this adapter declines a quote.
    registerBridgeAdapter(this.circleCctp);

    // `circle-cctpx` — EURC over Circle's CCTP for non-USDC assets, also
    // on App Kit. A different Circle product from USDC, so a different
    // adapter, never a branch (§2).
    registerBridgeAdapter(this.circleCctpx);

    // `cctp` — USDC between EVM and STELLAR, both directions, as raw
    // CCTP calls: App Kit does not reach Stellar. No overlap with
    // `circle-cctp`, which never touches a Stellar chain.
    registerBridgeAdapter(this.cctpStellar);

    // `tower` — SAME-CHAIN swaps on Arc only. It never overlaps the two
    // above: they refuse same-chain routes and it refuses cross-chain
    // ones. LI.FI's Arc mainnet is dark, so this is Arc's only swap route.
    registerBridgeAdapter(this.tower);
  }
}
