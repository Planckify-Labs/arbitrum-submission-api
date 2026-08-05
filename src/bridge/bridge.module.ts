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
import { LifiBridgeAdapter } from "./providers/lifi.adapter";
import { registerBridgeAdapter } from "./registry";

@Module({
  controllers: [BridgeController],
  providers: [BridgeService, LifiBridgeAdapter, CctpStellarAdapter],
  exports: [BridgeService],
})
export class BridgeModule implements OnModuleInit {
  constructor(
    private readonly lifi: LifiBridgeAdapter,
    private readonly cctpStellar: CctpStellarAdapter,
  ) {}

  onModuleInit(): void {
    // `lifi` — any asset, 72 chains, EVM + Solana + Sui. Misses Stellar.
    registerBridgeAdapter(this.lifi);

    // `cctp` — USDC only, and deliberately scoped to routes TOUCHING
    // STELLAR (§5.4 / §10.5). It is not a general EVM provider: LI.FI
    // already aggregates CCTP and picks it when it is the best USDC route
    // (§2.1), so an EVM-capable `cctp` adapter would add an arbitration
    // problem without adding a single new capability. With no overlap
    // there is nothing to arbitrate.
    registerBridgeAdapter(this.cctpStellar);
  }
}
