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
  NotFoundException,
  BadRequestException,
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
          const packedResult = `${purchase.id}#${existingRefIdStatus.bookingId}#${purchase.productVariant.id}`;

          return res.status(200).send({
            ...purchase,
            bookingId: existingRefIdStatus.bookingId,
            packed: {
              result: packedResult,
            },
          });
        }

        const errorMessage = `Reference ID ${refId} was previously processed but failed`;
        return res.status(200).send({
          packed: {
            result: `ERROR#409#${errorMessage}`,
          },
        });
      }
    } catch (idempotencyCheckError) {
      this.logger.error(
        "Error during idempotency check:",
        idempotencyCheckError,
      );
    }

    try {
      const purchase = await this.purchasesService.create(createPurchaseDto);
      const packedResult = `${purchase.id}#${purchase.bookingId}#${purchase.productVariant.id}`;

      return res.status(200).send({
        ...purchase,
        packed: {
          result: packedResult,
        },
      });
    } catch (error) {
      this.logger.error("error details:", error);
      this.logger.error("Error message:", error.message);
      this.logger.error("Error stack:", error.stack);

      const statusCode = error.status || 500;

      let userFriendlyMessage: string;

      if (error instanceof ConflictException) {
        userFriendlyMessage = "Request already processed";
      } else if (error instanceof NotFoundException) {
        userFriendlyMessage = "Resource not found";
      } else if (error instanceof BadRequestException) {
        userFriendlyMessage = "Invalid request data";
      } else if (statusCode >= 400 && statusCode < 500) {
        userFriendlyMessage = "Client error occurred";
      } else {
        userFriendlyMessage = "Internal server error";
      }

      return res.status(200).send({
        packed: {
          result: `ERROR#${statusCode}#${userFriendlyMessage}`,
        },
      });
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
