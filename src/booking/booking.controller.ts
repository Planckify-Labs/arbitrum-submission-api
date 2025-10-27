import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Put,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { BookingService } from "./booking.service";
import { CreateBookingDto } from "./dto/booking.dto";
import { BookingQueryDto } from "./dto/booking-query.dto";
import {
  ApiCreateBooking,
  ApiGetWalletBookings,
  ApiGetLatestBooking,
  ApiGetBookingStats,
  ApiExecuteBooking,
  ApiCancelBooking,
} from "../decorators/swagger/booking.decorators";
import { BookingRateLimitGuard } from "./guards/booking-rate-limit.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@Controller("bookings")
@ApiTags("bookings")
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post()
  @UseGuards(BookingRateLimitGuard)
  @ApiCreateBooking()
  createBooking(@Body() createBookingDto: CreateBookingDto) {
    return this.bookingService.createBooking(createBookingDto);
  }

  @Get("wallet/:walletAddress")
  @UseGuards(JwtAuthGuard)
  @ApiGetWalletBookings()
  getBookings(
    @Param("walletAddress") walletAddress: string,
    @Query() query: BookingQueryDto,
    @Request() req,
  ) {
    if (req.user.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new ForbiddenException("You can only access your own wallet data");
    }
    return this.bookingService.getBookings(walletAddress, query);
  }

  @Get("wallet/:walletAddress/latest")
  @UseGuards(JwtAuthGuard)
  @ApiGetLatestBooking()
  getLatestBooking(
    @Param("walletAddress") walletAddress: string,
    @Request() req,
  ) {
    if (req.user.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new ForbiddenException("You can only access your own wallet data");
    }
    return this.bookingService.getLatestBooking(walletAddress);
  }

  @Get("wallet/:walletAddress/stats")
  @UseGuards(JwtAuthGuard)
  @ApiGetBookingStats()
  getBookingStats(
    @Param("walletAddress") walletAddress: string,
    @Request() req,
  ) {
    if (req.user.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new ForbiddenException("You can only access your own wallet data");
    }
    return this.bookingService.getBookingStats(walletAddress);
  }

  @Put(":id/execute")
  @UseGuards(JwtAuthGuard)
  @ApiExecuteBooking()
  executeBooking(@Param("id") id: string, @Request() req) {
    return this.bookingService.markBookingExecuted(id, req.user);
  }

  @Put(":id/cancel")
  @UseGuards(JwtAuthGuard)
  @ApiCancelBooking()
  cancelBooking(@Param("id") id: string, @Request() req) {
    return this.bookingService.cancelBooking(id, req.user);
  }
}
