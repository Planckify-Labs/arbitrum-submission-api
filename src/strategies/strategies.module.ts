import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { PrismaModule } from "../prisma/prisma.module";
import { ValkeyModule } from "../valkey/valkey.module";
import { PushModule } from "../push/push.module";
import { StrategiesService } from "./strategies.service";
import { StrategiesScheduler } from "./strategies.scheduler";
import { StrategiesController } from "./strategies.controller";
import { DeFiLlamaClient } from "./external/defillama.client";
import { ZerionClient } from "./external/zerion.client";
import { LifiClient } from "./external/lifi.client";
import { DeBankClient } from "./external/debank.client";
import { ScoringService } from "./scoring/scoring.service";
import { DefiLlamaPollProcessor } from "./workers/defillama-poll.processor";
import { ScoreOpportunitiesProcessor } from "./workers/score-opportunities.processor";
import { StablecoinDepegWatcherProcessor } from "./workers/stablecoin-depeg-watcher.processor";
import { RebalanceTriggerProcessor } from "./workers/rebalance-trigger.processor";
import { GoalDeadlineWatcherProcessor } from "./workers/goal-deadline-watcher.processor";
import { AutoCompoundWatcherProcessor } from "./workers/auto-compound-watcher.processor";

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
    ZerionClient,
    LifiClient,
    DeBankClient,
    ScoringService,
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
