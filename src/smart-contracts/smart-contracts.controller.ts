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
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SmartContractsService } from "./smart-contracts.service";
import { CreateSmartContractDto } from "./dto/create-smart-contract.dto";
import { UpdateSmartContractDto } from "./dto/update-smart-contract.dto";
import { SearchSmartContractDto } from "./dto/search-smart-contract.dto";
import {
  CreateContractAbiDto,
  UpdateContractAbiDto,
} from "./dto/contract-abi.dto";
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
import { Roles } from "../decorators/roles.decorator";
import { UserRole } from "@generated/prisma";

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
  findAll(@Query() paginationDto: CursorPaginationDto) {
    return this.smartContractsService.findAll(paginationDto);
  }

  @Get("search")
  @Public()
  @ApiKey()
  @ApiSearchSmartContractsPublic()
  search(
    @Query() searchParams: SearchSmartContractDto,
    @Query() paginationDto: CursorPaginationDto,
  ) {
    return this.smartContractsService.search(searchParams, paginationDto);
  }

  @Get("abis")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  findAllAbis() {
    return this.smartContractsService.findAllAbis();
  }

  @Get("abis/:id")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  findAbiById(@Param("id") id: string) {
    return this.smartContractsService.findAbiById(id);
  }

  @Post("abis")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  createAbi(@Body() dto: CreateContractAbiDto) {
    return this.smartContractsService.createAbi(dto);
  }

  @Put("abis/:id")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  updateAbi(@Param("id") id: string, @Body() dto: UpdateContractAbiDto) {
    return this.smartContractsService.updateAbi(id, dto);
  }

  @Delete("abis/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  removeAbi(@Param("id") id: string) {
    return this.smartContractsService.deleteAbi(id);
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
