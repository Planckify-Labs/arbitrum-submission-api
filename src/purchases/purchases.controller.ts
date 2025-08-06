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
    this.logger.log("Request headers:", JSON.stringify(res.req.headers, null, 2));
    this.logger.log("Request method:", res.req.method);
    this.logger.log("Request URL:", res.req.url);
    this.logger.log("Request IP:", res.req.ip || res.req.connection.remoteAddress);
    this.logger.log("=====================================");

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
      if (
        error instanceof ConflictException &&
        error.message.includes("already been processed") &&
        !error.message.includes("failed")
      ) {
        const refId = createPurchaseDto.refId;

        try {
          const refIdStatus =
            await this.purchasesService.getReferenceIdWithPurchase(refId);

          if (refIdStatus && refIdStatus.purchase) {
            const purchase = refIdStatus.purchase;
            const packedResult = `${purchase.id}#${refIdStatus.bookingId}#${purchase.productVariant.id}`;

            return res.status(200).send({
              ...purchase,
              bookingId: refIdStatus.bookingId,
              packed: {
                result: packedResult,
              },
            });
          }
        } catch (innerError) {
          this.logger.error("Error retrieving reference ID status:", innerError);
        }
      }

      const packedError = this.mapErrorToPackedFormat(error);
      return res.status(error.status || 500).send(packedError);
    }
  }

  private mapErrorToPackedFormat(error: {
    status?: number;
    message?: string;
  }): { packed: { result: string } } {
    const statusCodeMap: Record<number, string> = {
      400: "BAD_REQ",
      404: "NOT_FOUND",
      409: "CONFLICT",
      429: "RATE_LMT",
    };

    const statusCode = error.status || 500;
    const errorCode = statusCodeMap[statusCode] || "SRV_ERR";

    const errorPatterns: Array<{ patterns: string[]; detail: string }> = [
      { patterns: ["booking", "not found"], detail: "BK_NOT_FND" },
      { patterns: ["booking", "expired"], detail: "BK_EXPIRED" },
      { patterns: ["booking", "pending"], detail: "BK_NOT_PEND" },
      { patterns: ["wallet address mismatch"], detail: "WALLET_MISM" },
      { patterns: ["network", "not found"], detail: "NET_NOT_FND" },
      { patterns: ["network", "not active"], detail: "NET_INACTIVE" },
      { patterns: ["smart contract", "not found"], detail: "CTR_NOT_FND" },
      { patterns: ["smart contract", "not active"], detail: "CTR_INACTIVE" },
      { patterns: ["token", "not found"], detail: "TKN_NOT_FND" },
      { patterns: ["customer information"], detail: "CUST_INFO_REQ" },
      { patterns: ["reference id", "processed"], detail: "DUP_REF_ID" },
      { patterns: ["failed to process order"], detail: "VENDOR_ERR" },
      { patterns: ["validation", "must start with"], detail: "VALID_ERR" },
      {
        patterns: ["should not be empty", "must be a string"],
        detail: "FIELD_REQ",
      },
    ];

    let errorDetail = "GEN_ERR";
    if (error.message) {
      const message = error.message.toLowerCase();
      const matchedPattern = errorPatterns.find((pattern) =>
        pattern.patterns.every((p) => message.includes(p)),
      );
      if (matchedPattern) {
        errorDetail = matchedPattern.detail;
      }
    }

    return {
      packed: {
        result: `ERROR#${statusCode}#${errorCode}#${errorDetail}`,
      },
    };
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
