import { Controller, Get, Post, Body, Param, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PurchasesService } from "./purchases.service";
import { CreatePurchaseDto, UpdatePurchaseDto } from "./dto/purchase.dto";
import { SearchPurchaseDto } from "./dto/search-purchase.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreatePurchase,
  ApiGetPurchase,
  ApiGetPurchases,
  ApiGetPurchaseStatus,
  ApiUpdatePurchaseStatus,
  ApiSearchPurchases,
  ApiGetUserPurchases,
  ApiGetTokenPurchases,
  ApiGetBlockchainPurchases,
} from "../decorators/swagger/purchase.decorators";
import { Public } from "../decorators/public.decorator";

@Controller("purchases")
@ApiTags("purchases")
@Public()
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @ApiCreatePurchase()
  create(@Body() createPurchaseDto: CreatePurchaseDto) {
    return this.purchasesService.create(createPurchaseDto);
  }

  @Get()
  @ApiGetPurchases()
  findAll(@Query() paginationDto: CursorPaginationDto) {
    return this.purchasesService.findAll(paginationDto);
  }

  @Get("search")
  @ApiSearchPurchases()
  search(
    @Query() searchParams: SearchPurchaseDto,
    @Query() paginationDto: CursorPaginationDto,
  ) {
    return this.purchasesService.search(searchParams, paginationDto);
  }

  @Get("user/:userId")
  @ApiGetUserPurchases()
  findByUser(
    @Param("userId") userId: string,
    @Query() paginationDto: CursorPaginationDto,
  ) {
    return this.purchasesService.findByUser(userId, paginationDto);
  }

  @Get("token/:tokenId")
  @ApiGetTokenPurchases()
  findByToken(
    @Param("tokenId") tokenId: string,
    @Query() paginationDto: CursorPaginationDto,
  ) {
    return this.purchasesService.findByToken(tokenId, paginationDto);
  }

  @Get("blockchain/:blockchainId")
  @ApiGetBlockchainPurchases()
  findByBlockchain(
    @Param("blockchainId") blockchainId: string,
    @Query() paginationDto: CursorPaginationDto,
  ) {
    return this.purchasesService.findByBlockchain(blockchainId, paginationDto);
  }

  @Get(":id")
  @ApiGetPurchase()
  findOne(@Param("id") id: string) {
    return this.purchasesService.findOne(id);
  }

  @Get(":id/status")
  @ApiGetPurchaseStatus()
  getStatus(@Param("id") id: string) {
    return this.purchasesService.getStatus(id);
  }

  @Put(":id/status")
  @ApiUpdatePurchaseStatus()
  updateStatus(
    @Param("id") id: string,
    @Body() updatePurchaseDto: UpdatePurchaseDto,
  ) {
    return this.purchasesService.updateStatus(id, updatePurchaseDto);
  }
}
