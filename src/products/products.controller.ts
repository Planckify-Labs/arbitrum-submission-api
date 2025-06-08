import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  HttpCode,
  HttpStatus,
  Query,
} from "@nestjs/common";
import { Transform } from "class-transformer";

import { ProductsService } from "./products.service";
import { ApiTags } from "@nestjs/swagger";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import {
  CreateProductPriceDto,
  UpdateProductPriceDto,
} from "./dto/product-price.dto";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreateProduct,
  ApiDeleteProduct,
  ApiGetProduct,
  ApiGetProducts,
  ApiGetProductsByCategory,
  ApiGetCategories,
  ApiGetProductByCode,
  ApiUpdateProduct,
  ApiSearchProducts,
  ApiGetProductPrices,
  ApiCreateProductPrice,
  ApiUpdateProductPrice,
  ApiDeleteProductPrice,
  ApiCreateCategory,
  ApiUpdateCategory,
  ApiDeleteCategory,
  ApiGetCategory,
  ApiGetProductVariants,
  ApiSearchProductVariants,
  ApiGetProductVariant,
} from "../decorators/swagger/product.decorators";
import { SearchProductDto } from "./dto/search-product.dto";
import { SearchProductVariantDto } from "./dto/search-product-variant.dto";

@Controller("products")
@ApiTags("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get("search")
  @ApiSearchProducts()
  search(
    @Query() searchDto: SearchProductDto,
    @Query() paginationDto: CursorPaginationDto = new CursorPaginationDto(),
  ) {
    return this.productsService.search(searchDto, paginationDto);
  }

  @Get()
  @ApiGetProducts()
  findAll(@Query() paginationDto: CursorPaginationDto) {
    return this.productsService.findAll(paginationDto);
  }

  @Get("categories")
  @ApiGetCategories()
  findAllCategories(@Query() paginationDto: CursorPaginationDto) {
    return this.productsService.findAllCategories(paginationDto);
  }

  @Get("categories/:categoryId")
  @ApiGetProductsByCategory()
  findByCategory(@Param("categoryId") categoryId: string) {
    return this.productsService.findByCategory(categoryId);
  }

  @Get("codes/:code")
  @ApiGetProductByCode()
  findByCode(@Param("code") code: string) {
    return this.productsService.findByCode(code);
  }

  @Get(":id")
  @ApiGetProduct()
  findOne(@Param("id") id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @ApiCreateProduct()
  create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }

  @Put(":id")
  @ApiUpdateProduct()
  update(@Param("id") id: string, @Body() updateProductDto: UpdateProductDto) {
    return this.productsService.update(id, updateProductDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteProduct()
  remove(@Param("id") id: string) {
    return this.productsService.remove(id);
  }

  @Get(":id/prices")
  @ApiGetProductPrices()
  findPrices(@Param("id") id: string) {
    return this.productsService.findPrices(id);
  }

  @Post(":id/prices")
  @ApiCreateProductPrice()
  createPrice(
    @Param("id") id: string,
    @Body() createProductPriceDto: CreateProductPriceDto,
  ) {
    return this.productsService.createPrice(id, createProductPriceDto);
  }

  @Put("prices/:priceId")
  @ApiUpdateProductPrice()
  updatePrice(
    @Param("priceId") priceId: string,
    @Body() updateProductPriceDto: UpdateProductPriceDto,
  ) {
    return this.productsService.updatePrice(priceId, updateProductPriceDto);
  }

  @Delete("prices/:priceId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteProductPrice()
  removePrice(@Param("priceId") priceId: string) {
    return this.productsService.removePrice(priceId);
  }

  @Post("categories")
  @ApiCreateCategory()
  createCategory(@Body() createCategoryDto: CreateCategoryDto) {
    return this.productsService.createCategory(createCategoryDto);
  }

  @Put("categories/:id")
  @ApiUpdateCategory()
  updateCategory(
    @Param("id") id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.productsService.updateCategory(id, updateCategoryDto);
  }

  @Delete("categories/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteCategory()
  removeCategory(@Param("id") id: string) {
    return this.productsService.removeCategory(id);
  }

  @Get("categories/:id")
  @ApiGetCategory()
  findOneCategory(@Param("id") id: string) {
    return this.productsService.findOneCategory(id);
  }

  @Get(":id/variants")
  @ApiGetProductVariants()
  findVariants(@Param("id") id: string) {
    return this.productsService.findVariants(id);
  }

  @Get("variants/search")
  @ApiSearchProductVariants()
  searchVariants(
    @Query() searchDto: SearchProductVariantDto,
    @Query() paginationDto: CursorPaginationDto = new CursorPaginationDto(),
  ) {
    return this.productsService.searchVariants(searchDto, paginationDto);
  }

  @Get("variants/:id")
  @ApiGetProductVariant()
  findOneVariant(@Param("id") id: string) {
    return this.productsService.findOneVariant(id);
  }
}
