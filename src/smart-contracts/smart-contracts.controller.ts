import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { SmartContractsService } from "./smart-contracts.service";
import { CreateSmartContractDto } from "./dto/create-smart-contract.dto";
import { UpdateSmartContractDto } from "./dto/update-smart-contract.dto";
import { SearchSmartContractDto } from "./dto/search-smart-contract.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreateSmartContract,
  ApiDeleteSmartContract,
  ApiUpdateSmartContract,
  ApiGetSmartContractsPublic,
  ApiSearchSmartContractsPublic,
  ApiGetSmartContractPublic,
  ApiGetSmartContractByChainIdPublic,
} from "../decorators/swagger/smart-contract.decorators";
import { Public } from "../decorators/public.decorator";
import { ApiKey } from "../decorators/api-key.decorator";

@Controller("smart-contracts")
@ApiTags("smart-contracts")
export class SmartContractsController {
  constructor(private readonly smartContractsService: SmartContractsService) {}

  @Post()
  @ApiCreateSmartContract()
  create(@Body() createSmartContractDto: CreateSmartContractDto) {
    return this.smartContractsService.create(createSmartContractDto);
  }

  @Get()
  @Public()
  @ApiKey()
  @ApiGetSmartContractsPublic()
  async findAll(
    @Query() paginationDto: CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } =
      await this.smartContractsService.findAll(paginationDto);
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get("search")
  @Public()
  @ApiKey()
  @ApiSearchSmartContractsPublic()
  async search(
    @Query() searchParams: SearchSmartContractDto,
    @Query() paginationDto: CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.smartContractsService.search(
      searchParams,
      paginationDto,
    );
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get("chain/:chainId")
  @Public()
  @ApiKey()
  @ApiGetSmartContractByChainIdPublic()
  findByChainId(@Param("chainId") chainId: string) {
    return this.smartContractsService.findByChainId(Number(chainId));
  }

  @Get(":id")
  @Public()
  @ApiKey()
  @ApiGetSmartContractPublic()
  findOne(@Param("id") id: string) {
    return this.smartContractsService.findOne(id);
  }

  @Put(":id")
  @ApiUpdateSmartContract()
  update(
    @Param("id") id: string,
    @Body() updateSmartContractDto: UpdateSmartContractDto,
  ) {
    return this.smartContractsService.update(id, updateSmartContractDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteSmartContract()
  remove(@Param("id") id: string) {
    return this.smartContractsService.remove(id);
  }
}
