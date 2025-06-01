import { Module } from "@nestjs/common";
import { ApiLogsService } from "./api-logs.service";
import { ApiLogsController } from "./api-logs.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [ApiLogsController],
  providers: [ApiLogsService],
  exports: [ApiLogsService],
})
export class ApiLogsModule {}
