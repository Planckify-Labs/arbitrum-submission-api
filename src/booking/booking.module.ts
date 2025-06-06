import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BookingService } from "./booking.service";
import { PrismaService } from "../prisma/prisma.service";
import { BookingController } from "./booking.controller";

@Module({
  imports: [ConfigModule],
  controllers: [BookingController],
  providers: [BookingService, PrismaService],
  exports: [BookingService],
})
export class BookingModule {}
