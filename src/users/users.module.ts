import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { UserResourceGuard } from "./guards/user-resource.guard";

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, UserResourceGuard],
  exports: [UsersService],
})
export class UsersModule {}
