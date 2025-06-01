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
import { BlockchainsService } from "./blockchains.service";
import { CreateBlockchainDto } from "./dto/create-blockchain.dto";
import { UpdateBlockchainDto } from "./dto/update-blockchain.dto";
import { SearchBlockchainDto } from "./dto/search-blockchain.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreateBlockchain,
  ApiDeleteBlockchain,
  ApiGetBlockchain,
  ApiGetBlockchains,
  ApiSearchBlockchains,
  ApiUpdateBlockchain,
} from "../decorators/swagger/blockchain.decorators";

@Controller("blockchains")
@ApiTags("blockchains")
export class BlockchainsController {
  constructor(private readonly blockchainsService: BlockchainsService) {}

  @Post()
  @ApiCreateBlockchain()
  create(@Body() createBlockchainDto: CreateBlockchainDto) {
    return this.blockchainsService.create(createBlockchainDto);
  }

  @Get()
  @ApiGetBlockchains()
  findAll(@Query() paginationDto: CursorPaginationDto) {
    return this.blockchainsService.findAll(paginationDto);
  }

  @Get("search")
  @ApiSearchBlockchains()
  search(
    @Query() searchParams: SearchBlockchainDto,
    @Query() paginationDto: CursorPaginationDto,
  ) {
    return this.blockchainsService.search(searchParams, paginationDto);
  }

  @Get(":id")
  @ApiGetBlockchain()
  findOne(@Param("id") id: string) {
    return this.blockchainsService.findOne(id);
  }

  @Put(":id")
  @ApiUpdateBlockchain()
  update(
    @Param("id") id: string,
    @Body() updateBlockchainDto: UpdateBlockchainDto,
  ) {
    return this.blockchainsService.update(id, updateBlockchainDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteBlockchain()
  remove(@Param("id") id: string) {
    return this.blockchainsService.remove(id);
  }
}
