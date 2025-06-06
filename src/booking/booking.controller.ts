import { Controller, Post, Get, Body, Param, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { BookingService } from "./booking.service";
import { CreateBookingDto, ExecuteBookingDto } from "./dto/booking.dto";
import { BookingQueryDto } from "./dto/booking-query.dto";
import {
  ApiCreateBooking,
  ApiGetWalletBookings,
  ApiGetLatestBooking,
  ApiGetBookingStats,
  ApiExecuteBooking,
  ApiCancelBooking,
} from "../decorators/swagger/booking.decorators";

@Controller("bookings")
@ApiTags("bookings")
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post()
  @ApiCreateBooking()
  createBooking(@Body() createBookingDto: CreateBookingDto) {
    return this.bookingService.createBooking(createBookingDto);
  }

  @Get("wallet/:walletAddress")
  @ApiGetWalletBookings()
  getBookings(
    @Param("walletAddress") walletAddress: string,
    @Query() query: BookingQueryDto,
  ) {
    return this.bookingService.getBookings(walletAddress, query);
  }

  @Get("wallet/:walletAddress/latest")
  @ApiGetLatestBooking()
  getLatestBooking(@Param("walletAddress") walletAddress: string) {
    return this.bookingService.getLatestBooking(walletAddress);
  }

  @Get("wallet/:walletAddress/stats")
  @ApiGetBookingStats()
  getBookingStats(@Param("walletAddress") walletAddress: string) {
    return this.bookingService.getBookingStats(walletAddress);
  }

  @Put(":id/execute")
  @ApiExecuteBooking()
  executeBooking(
    @Param("id") id: string,
    @Body() executeBookingDto: ExecuteBookingDto,
  ) {
    return this.bookingService.markBookingExecuted(
      id,
      executeBookingDto.purchaseId,
    );
  }

  @Put(":id/cancel")
  @ApiCancelBooking()
  cancelBooking(@Param("id") id: string) {
    return this.bookingService.cancelBooking(id);
  }
}
