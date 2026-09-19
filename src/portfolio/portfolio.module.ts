import { Module } from "@nestjs/common";
import { ZerionModule } from "../external/zerion";
import { PushModule } from "../push/push.module";
import { PortfolioDigestService } from "./portfolio-digest.service";
import { PortfolioController } from "./portfolio.controller";

@Module({
  imports: [ZerionModule, PushModule],
  controllers: [PortfolioController],
  providers: [PortfolioDigestService],
})
export class PortfolioModule {}
