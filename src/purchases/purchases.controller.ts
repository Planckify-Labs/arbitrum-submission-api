import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Query,
  Res,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { PurchasesService } from "./purchases.service";
import { CreatePurchaseDto, UpdatePurchaseDto } from "./dto/purchase.dto";
import { SearchPurchaseDto } from "./dto/search-purchase.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreatePurchasePublic,
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
import { ApiKey } from "../decorators/api-key.decorator";

@Controller("purchases")
@ApiTags("purchases")
@Public()
export class PurchasesController {
  private readonly logger = new Logger(PurchasesController.name);
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @Public()
  @ApiKey()
  @ApiCreatePurchasePublic()
  async create(
    @Body() createPurchaseDto: CreatePurchaseDto,
    @Res() res: Response,
  ) {
    this.logger.log("=== PURCHASE CREATION REQUEST ===");
    this.logger.log(
      "Received createPurchaseDto:",
      JSON.stringify(createPurchaseDto, null, 2),
    );
    this.logger.log(
      "Request headers:",
      JSON.stringify(res.req.headers, null, 2),
    );
    this.logger.log("Request method:", res.req.method);
    this.logger.log("Request URL:", res.req.url);
    this.logger.log(
      "Request IP:",
      res.req.ip || res.req.connection.remoteAddress,
    );
    this.logger.log("=====================================");

    const { refId } = createPurchaseDto;

    try {
      const existingRefIdStatus =
        await this.purchasesService.getReferenceIdWithPurchase(refId);

      if (existingRefIdStatus) {
        this.logger.log(
          `Idempotent request detected for refId: ${refId}. Status: ${existingRefIdStatus.status}`,
        );

        if (existingRefIdStatus.purchase) {
          const purchase = existingRefIdStatus.purchase;
          this.logger.log(
            `Returning existing purchase for refId: ${refId}, purchaseId: ${purchase.id}`,
          );

          return res.status(200).send({
            ...purchase,
            bookingId: existingRefIdStatus.bookingId,
          });
        }

        const errorMessage = `Reference ID ${refId} was previously used but the transaction failed. Please use a new reference ID.`;
        this.logger.warn(
          `Rejecting duplicate refId with failed status: ${refId}`,
        );
        throw new ConflictException(errorMessage);
      }
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      this.logger.error(
        "Error during idempotency check, proceeding with caution:",
        error,
      );
    }

    try {
      const purchase = await this.purchasesService.create(createPurchaseDto);

      return res.status(201).send(purchase);
    } catch (error) {
      this.logger.error("error details:", error);
      this.logger.error("Error message:", error.message);
      this.logger.error("Error stack:", error.stack);

      throw error;
    }
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
