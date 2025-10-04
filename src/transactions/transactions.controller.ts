import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { ApiTags } from "@nestjs/swagger";
import { TransactionsService } from "./transactions.service";
import { CreateTransactionDto } from "./dto/create-transaction.dto";
import { SearchTransactionDto } from "./dto/search-transaction.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreateTransaction,
  ApiGetTransaction,
  ApiGetTransactions,
  ApiGetUserTransactions,
  ApiSearchTransactions,
  ApiGetBlockchainTransactions,
  ApiGetTokenTransactions,
} from "../decorators/swagger/transaction.decorators";

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
  @ApiGetTransactions()
  findAll(@Query() paginationDto: CursorPaginationDto) {
    return this.transactionsService.findAll(paginationDto);
  }

  @Get("search")
  @ApiSearchTransactions()
  search(@Query() queryParams: SearchTransactionDto & CursorPaginationDto) {
    const { cursor, take, ...searchParams } = queryParams;
    const paginationDto: CursorPaginationDto = { cursor, take };

    return this.transactionsService.search(searchParams, paginationDto);
  }

  @Get(":id")
  @ApiGetTransaction()
  findOne(@Param("id") id: string) {
    return this.transactionsService.findOne(id);
  }

  @Get("user/:userId")
  @ApiGetUserTransactions()
  findByUser(@Param("userId") userId: string) {
    return this.transactionsService.findByUser(userId);
  }

  @Get("blockchain/:blockchainId")
  @ApiGetBlockchainTransactions()
  findByBlockchain(@Param("blockchainId") blockchainId: string) {
    return this.transactionsService.findByBlockchain(blockchainId);
  }

  @Get("token/:tokenId")
  @ApiGetTokenTransactions()
  findByToken(@Param("tokenId") tokenId: string) {
    return this.transactionsService.findByToken(tokenId);
  }
}
