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
  ApiCreateSmartContract,
  ApiDeleteSmartContract,
  ApiGetSmartContract,
  ApiGetSmartContracts,
  ApiSearchSmartContracts,
  ApiUpdateSmartContract,
} from "../decorators/swagger/smart-contract.decorators";

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
  @ApiGetSmartContracts()
  findAll() {
    return this.smartContractsService.findAll();
  }

  @Get("search")
  @ApiSearchSmartContracts()
  search(@Query() searchParams: SearchSmartContractDto) {
    return this.smartContractsService.search(searchParams);
  }

  @Get(":id")
  @ApiGetSmartContract()
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
