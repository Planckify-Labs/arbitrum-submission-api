import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PushModule } from "../push/push.module";
import { ValkeyModule } from "../valkey/valkey.module";
import { DeBankClient } from "./external/debank.client";
import { DeFiLlamaClient } from "./external/defillama.client";
import { LifiClient } from "./external/lifi.client";
import { SuiLstSource } from "./external/sui-lst.source";
import { ZerionClient } from "./external/zerion.client";
import { ScoringService } from "./scoring/scoring.service";
import { StrategiesController } from "./strategies.controller";
import { StrategiesScheduler } from "./strategies.scheduler";
import { StrategiesService } from "./strategies.service";
import { TargetResolverService } from "./targets/target-resolver.service";
import { AutoCompoundWatcherProcessor } from "./workers/auto-compound-watcher.processor";
import { DefiLlamaPollProcessor } from "./workers/defillama-poll.processor";
import { GoalDeadlineWatcherProcessor } from "./workers/goal-deadline-watcher.processor";
import { RebalanceTriggerProcessor } from "./workers/rebalance-trigger.processor";
import { ScoreOpportunitiesProcessor } from "./workers/score-opportunities.processor";
import { StablecoinDepegWatcherProcessor } from "./workers/stablecoin-depeg-watcher.processor";

@Module({
  imports: [
    PrismaModule,
    ValkeyModule,
    PushModule,
    BullModule.registerQueue(
      { name: "defillama-poll" },
      { name: "score-opportunities" },
      { name: "stablecoin-depeg-watcher" },
      { name: "rebalance-trigger" },
      { name: "goal-deadline-watcher" },
      { name: "auto-compound-watcher" },
    ),
  ],
  controllers: [StrategiesController],
  providers: [
    StrategiesService,
    StrategiesScheduler,
    DeFiLlamaClient,
    SuiLstSource,
    ZerionClient,
    LifiClient,
    DeBankClient,
    ScoringService,
    TargetResolverService,
    DefiLlamaPollProcessor,
    ScoreOpportunitiesProcessor,
    StablecoinDepegWatcherProcessor,
    RebalanceTriggerProcessor,
    GoalDeadlineWatcherProcessor,
    AutoCompoundWatcherProcessor,
  ],
  exports: [StrategiesService, ScoringService],
})
export class StrategiesModule {}
