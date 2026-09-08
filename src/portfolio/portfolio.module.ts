import { Module } from "@nestjs/common";
import { ZerionModule } from "../external/zerion";
import { PortfolioController } from "./portfolio.controller";

@Module({
  imports: [ZerionModule],
  controllers: [PortfolioController],
})
export class PortfolioModule {}
