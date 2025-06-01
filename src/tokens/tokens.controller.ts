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
import { TokensService } from "./tokens.service";
import { CreateTokenDto } from "./dto/create-token.dto";
import { UpdateTokenDto } from "./dto/update-token.dto";
import { SearchTokenDto } from "./dto/search-token.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreateToken,
  ApiDeleteToken,
  ApiGetToken,
  ApiGetTokens,
  ApiSearchTokens,
  ApiUpdateToken,
} from "../decorators/swagger/token.decorators";

@Controller("tokens")
@ApiTags("tokens")
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Post()
  @ApiCreateToken()
  create(@Body() createTokenDto: CreateTokenDto) {
    return this.tokensService.create(createTokenDto);
  }

  @Get()
  @ApiGetTokens()
  findAll(@Query() paginationDto: CursorPaginationDto) {
    return this.tokensService.findAll(paginationDto);
  }

  @Get("search")
  @ApiSearchTokens()
  search(
    @Query() searchParams: SearchTokenDto,
    @Query() paginationDto: CursorPaginationDto,
  ) {
    return this.tokensService.search(searchParams, paginationDto);
  }

  @Get(":id")
  @ApiGetToken()
  findOne(@Param("id") id: string) {
    return this.tokensService.findOne(id);
  }

  @Put(":id")
  @ApiUpdateToken()
  update(@Param("id") id: string, @Body() updateTokenDto: UpdateTokenDto) {
    return this.tokensService.update(id, updateTokenDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteToken()
  remove(@Param("id") id: string) {
    return this.tokensService.remove(id);
  }
}
