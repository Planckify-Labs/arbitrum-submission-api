import { Controller, Get, Post, Body, Put, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { TransactionsService } from "./transactions.service";
import { CreateTransactionDto } from "./dto/create-transaction.dto";
import { UpdateTransactionDto } from "./dto/update-transaction.dto";
import { SearchTransactionDto } from "./dto/search-transaction.dto";
import {
  ApiCreateTransaction,
  ApiGetTransaction,
  ApiGetTransactions,
  ApiGetUserTransactions,
  ApiSearchTransactions,
  ApiUpdateTransactionStatus,
  ApiGetBlockchainTransactions,
  ApiGetTokenTransactions,
} from "../decorators/swagger/transaction.decorators";

@Controller("transactions")
@ApiTags("transactions")
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @ApiCreateTransaction()
  create(@Body() createTransactionDto: CreateTransactionDto) {
    return this.transactionsService.create(createTransactionDto);
  }

  @Get()
  @ApiGetTransactions()
  findAll() {
    return this.transactionsService.findAll();
  }

  @Get("search")
  @ApiSearchTransactions()
  search(@Query() searchParams: SearchTransactionDto) {
    return this.transactionsService.search(searchParams);
  }

  @Get(":id")
  @ApiGetTransaction()
  findOne(@Param("id") id: string) {
    return this.transactionsService.findOne(id);
  }

  @Put(":id/status")
  @ApiUpdateTransactionStatus()
  updateStatus(
    @Param("id") id: string,
    @Body() updateTransactionDto: UpdateTransactionDto,
  ) {
    return this.transactionsService.updateStatus(id, updateTransactionDto);
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
