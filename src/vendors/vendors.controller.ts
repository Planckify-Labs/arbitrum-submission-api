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
import { VendorsService } from "./vendors.service";
import { CreateVendorDto } from "./dto/create-vendor.dto";
import { UpdateVendorDto } from "./dto/update-vendor.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreateVendor,
  ApiDeleteVendor,
  ApiGetVendor,
  ApiGetVendors,
  ApiGetVendorProducts,
  ApiUpdateVendor,
} from "../decorators/swagger/vendor.decorators";

@Controller("vendors")
@ApiTags("vendors")
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Post()
  @ApiCreateVendor()
  create(@Body() createVendorDto: CreateVendorDto) {
    return this.vendorsService.create(createVendorDto);
  }

  @Get()
  @ApiGetVendors()
  async findAll(@Res({ passthrough: true }) res: Response) {
    const { items, total } = await this.vendorsService.findAll();
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get(":id")
  @ApiGetVendor()
  findOne(@Param("id") id: string) {
    return this.vendorsService.findOne(id);
  }

  @Put(":id")
  @ApiUpdateVendor()
  update(@Param("id") id: string, @Body() updateVendorDto: UpdateVendorDto) {
    return this.vendorsService.update(id, updateVendorDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteVendor()
  remove(@Param("id") id: string) {
    return this.vendorsService.remove(id);
  }

  @Get(":id/products")
  @ApiGetVendorProducts()
  findVendorProducts(
    @Param("id") id: string,
    @Query() pagination: CursorPaginationDto,
  ) {
    return this.vendorsService.findVendorProducts(id, pagination);
  }
}
