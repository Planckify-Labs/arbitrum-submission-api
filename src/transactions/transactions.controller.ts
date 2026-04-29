import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Request, Response } from "express";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { TransactionsService } from "./transactions.service";
import { CreateTransactionDto } from "./dto/create-transaction.dto";
import { SearchTransactionDto } from "./dto/search-transaction.dto";
import { UserTransactionHistoryDto } from "./dto/user-transaction-history.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreateTransaction,
  ApiGetTransaction,
  ApiGetTransactions,
  ApiGetUserTransactions,
  ApiSearchTransactions,
  ApiGetBlockchainTransactions,
  ApiGetTokenTransactions,
  ApiGetMyTransactionHistory,
} from "../decorators/swagger/transaction.decorators";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../decorators/roles.decorator";
import { UserRole } from "@generated/prisma";

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller("transactions")
@ApiTags("transactions")
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @ApiCreateTransaction()
  create(
    @Req() req: Request & { user?: { id: string } },
    @Body() createTransactionDto: CreateTransactionDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("Missing authenticated user");
    }
    return this.transactionsService.create(userId, createTransactionDto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiGetTransactions()
  async findAll(
    @Query() paginationDto: CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } =
      await this.transactionsService.findAll(paginationDto);
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get("search")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiSearchTransactions()
  async search(
    @Query() queryParams: SearchTransactionDto & CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { cursor, take, skip, ...searchParams } = queryParams;
    const paginationDto: CursorPaginationDto = { cursor, take, skip };

    const { items, total } = await this.transactionsService.search(
      searchParams,
      paginationDto,
    );
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get("my-history")
  @ApiGetMyTransactionHistory()
  getMyTransactionHistory(
    @Req() req: Request & { user: { id: string } },
    @Query() queryParams: UserTransactionHistoryDto,
  ) {
    const userId = req.user.id;
    const { type, cursor, take } = queryParams;
    const paginationDto: CursorPaginationDto = { cursor, take };

    return this.transactionsService.findUserTransactionHistory(
      userId,
      type,
      paginationDto,
    );
  }

  @Get("payment/:id")
  findPaymentDetail(@Param("id") id: string) {
    return this.transactionsService.findPaymentDetail(id);
  }

  @Get(":id")
  @ApiGetTransaction()
  findOne(@Param("id") id: string) {
    return this.transactionsService.findOne(id);
  }

  @Get("user/:userId")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiGetUserTransactions()
  async findByUser(
    @Param("userId") userId: string,
    @Query() paginationDto: CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.transactionsService.findByUser(
      userId,
      paginationDto,
    );
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get("blockchain/:blockchainId")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiGetBlockchainTransactions()
  async findByBlockchain(
    @Param("blockchainId") blockchainId: string,
    @Query() paginationDto: CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.transactionsService.findByBlockchain(
      blockchainId,
      paginationDto,
    );
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get("token/:tokenId")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiGetTokenTransactions()
  async findByToken(
    @Param("tokenId") tokenId: string,
    @Query() paginationDto: CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.transactionsService.findByToken(
      tokenId,
      paginationDto,
    );
    res.setHeader("X-Total-Count", String(total));
    return items;
  }
}
