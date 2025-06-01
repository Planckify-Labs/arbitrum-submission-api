import { Controller, Get, Post, Body, Param, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PurchasesService } from "./purchases.service";
import { CreatePurchaseDto, UpdatePurchaseDto } from "./dto/purchase.dto";
import { SearchPurchaseDto } from "./dto/search-purchase.dto";
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

@Controller("purchases")
@ApiTags("purchases")
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @ApiCreatePurchase()
  create(@Body() createPurchaseDto: CreatePurchaseDto) {
    return this.purchasesService.create(createPurchaseDto);
  }

  @Get()
  @ApiGetPurchases()
  findAll() {
    return this.purchasesService.findAll();
  }

  @Get("search")
  @ApiSearchPurchases()
  search(@Query() searchParams: SearchPurchaseDto) {
    return this.purchasesService.search(searchParams);
  }

  @Get("user/:userId")
  @ApiGetUserPurchases()
  findByUser(@Param("userId") userId: string) {
    return this.purchasesService.findByUser(userId);
  }

  @Get("token/:tokenId")
  @ApiGetTokenPurchases()
  findByToken(@Param("tokenId") tokenId: string) {
    return this.purchasesService.findByToken(tokenId);
  }

  @Get("blockchain/:blockchainId")
  @ApiGetBlockchainPurchases()
  findByBlockchain(@Param("blockchainId") blockchainId: string) {
    return this.purchasesService.findByBlockchain(blockchainId);
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
