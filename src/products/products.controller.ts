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
  NotFoundException,
  Request,
  UseGuards,
} from "@nestjs/common";
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
  ApiGetCategories,
  ApiGetProductByCode,
  ApiUpdateProduct,
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
  ApiCreateProductInputField,
  ApiUpdateProductInputField,
  ApiDeleteProductInputField,
  ApiGetProductsPublic,
  ApiSearchProductsPublic,
  ApiGetProductsGroupedByCategoriesPublic,
  ApiGetProductsByCategoryPublic,
  ApiGetProductPublic,
  ApiGetProductInputFieldPublic,
  ApiGetProductVariantPublic,
  ApiGetProductRecommendationsPublic,
} from "../decorators/swagger/product.decorators";
import { Public } from "../decorators/public.decorator";
import { ApiKey } from "../decorators/api-key.decorator";
import { OptionalJwtAuthGuard } from "../auth/guards/optional-jwt-auth.guard";
import { SearchProductDto } from "./dto/search-product.dto";
import { SearchProductVariantDto } from "./dto/search-product-variant.dto";
import { ProductInputValidatorService } from "./services/product-input-validator.service";
import {
  CreateProductInputFieldDto,
  UpdateProductInputFieldDto,
} from "./dto/product-input-field.dto";
import { PaymentFeaturedResponseDto } from "./dto/payment-featured.dto";
import { ApiOperation, ApiQuery, ApiResponse } from "@nestjs/swagger";

@Controller("products")
@ApiTags("products")
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly productInputValidator: ProductInputValidatorService,
  ) {}

  @Get("search")
  @Public()
  @ApiKey()
  @ApiSearchProductsPublic()
  search(
    @Query() searchDto: SearchProductDto,
    @Query() paginationDto: CursorPaginationDto = new CursorPaginationDto(),
  ) {
    return this.productsService.search(searchDto, paginationDto);
  }

  @Get("recommendations")
  @Public()
  @ApiKey()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiGetProductRecommendationsPublic()
  getRecommendations(
    @Request() req: { user?: { id: string; walletAddress?: string } },
    @Query("limit") limit?: string,
  ) {
    const take = Math.min(Math.max(parseInt(limit ?? "10", 10) || 10, 1), 20);
    if (req.user?.id) {
      return this.productsService.getPersonalizedRecommendations(
        req.user.id,
        req.user.walletAddress,
        take,
      );
    }
    return this.productsService.getRecommendations(take);
  }

  @Get("trending")
  @Public()
  @ApiKey()
  @ApiOperation({ summary: "Get trending products", description: "Products with most purchases and redemptions in the last 24 hours." })
  @ApiQuery({ name: "limit", required: false, type: "number", example: 10 })
  @ApiResponse({ status: 200, description: "Trending products" })
  getTrending(@Query("limit") limit?: string) {
    const take = Math.min(Math.max(parseInt(limit ?? "10", 10) || 10, 1), 20);
    return this.productsService.getTrending(take);
  }

  @Get("new-arrivals")
  @Public()
  @ApiKey()
  @ApiOperation({ summary: "Get new arrivals", description: "Most recently added active products." })
  @ApiQuery({ name: "limit", required: false, type: "number", example: 10 })
  @ApiResponse({ status: 200, description: "New arrivals" })
  getNewArrivals(@Query("limit") limit?: string) {
    const take = Math.min(Math.max(parseInt(limit ?? "10", 10) || 10, 1), 20);
    return this.productsService.getNewArrivals(take);
  }

  @Get("search/suggestions")
  @Public()
  @ApiKey()
  @ApiOperation({ summary: "Search suggestions", description: "Fast prefix-match suggestions for the search bar." })
  @ApiQuery({ name: "q", required: true, type: "string", example: "ml" })
  @ApiResponse({ status: 200, description: "Search suggestions" })
  getSearchSuggestions(@Query("q") q?: string) {
    return this.productsService.getSearchSuggestions(q ?? "");
  }

  @Get("payment-featured")
  @Public()
  @ApiKey()
  @ApiOperation({
    summary: "Get payment featured config",
    description:
      "Returns featured payment categories and products for the home screen.",
  })
  @ApiResponse({
    status: 200,
    description: "Payment featured config retrieved successfully",
  })
  getPaymentFeatured(): Promise<PaymentFeaturedResponseDto> {
    return this.productsService.getPaymentFeatured();
  }

  @Get()
  @Public()
  @ApiKey()
  @ApiGetProductsPublic()
  findAll(@Query() paginationDto: CursorPaginationDto) {
    return this.productsService.findAll(paginationDto);
  }

  @Get("vouchers")
  @Public()
  @ApiKey()
  @ApiGetProductsPublic()
  findVouchers(@Query() paginationDto: CursorPaginationDto) {
    return this.productsService.findVouchers(paginationDto);
  }

  @Get("non-vouchers")
  @Public()
  @ApiKey()
  @ApiGetProductsPublic()
  findNonVouchers(@Query() paginationDto: CursorPaginationDto) {
    return this.productsService.findNonVouchers(paginationDto);
  }

  @Get("grouped-by-categories")
  @Public()
  @ApiKey()
  @ApiGetProductsGroupedByCategoriesPublic()
  findAllGroupedByCategories(@Query("take") take?: number) {
    return this.productsService.findAllGroupedByCategories(take);
  }

  @Get("categories")
  @ApiGetCategories()
  findAllCategories(@Query() paginationDto: CursorPaginationDto) {
    return this.productsService.findAllCategories(paginationDto);
  }

  @Get("categories/:categoryId/products")
  @Public()
  @ApiKey()
  @ApiGetProductsByCategoryPublic()
  findByCategory(@Param("categoryId") categoryId: string) {
    return this.productsService.findByCategory(categoryId);
  }

  @Get("codes/:code")
  @ApiGetProductByCode()
  findByCode(@Param("code") code: string) {
    return this.productsService.findByCode(code);
  }

  @Get(":id")
  @Public()
  @ApiKey()
  @ApiGetProductPublic()
  findOne(@Param("id") id: string) {
    return this.productsService.findOne(id);
  }

  @Get(":id/stats")
  @Public()
  @ApiKey()
  @ApiOperation({ summary: "Get product sales stats", description: "Total purchases + redemptions count for a product, including today's count." })
  @ApiResponse({ status: 200, description: "Product stats" })
  getProductStats(@Param("id") id: string) {
    return this.productsService.getProductStats(id);
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
  @Public()
  @ApiKey()
  @ApiGetProductVariantPublic()
  findOneVariant(@Param("id") id: string) {
    return this.productsService.findOneVariant(id);
  }

  @Get(":id/input-fields")
  @Public()
  @ApiKey()
  @ApiGetProductInputFieldPublic()
  async getProductInputFields(@Param("id") id: string) {
    const product = await this.productsService.findOne(id);
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    const inputFields =
      await this.productInputValidator.getProductInputFields(id);
    return {
      productId: id,
      productName: product.name,
      forms: inputFields,
    };
  }

  @Post(":id/input-fields")
  @ApiCreateProductInputField()
  async createProductInputField(
    @Param("id") id: string,
    @Body() createInputFieldDto: CreateProductInputFieldDto,
  ) {
    const product = await this.productsService.findOne(id);
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return this.productsService.createProductInputField(
      id,
      createInputFieldDto,
    );
  }

  @Put(":id/input-fields/:fieldId")
  @ApiUpdateProductInputField()
  async updateProductInputField(
    @Param("id") id: string,
    @Param("fieldId") fieldId: string,
    @Body() updateInputFieldDto: UpdateProductInputFieldDto,
  ) {
    const product = await this.productsService.findOne(id);
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return this.productsService.updateProductInputField(
      id,
      fieldId,
      updateInputFieldDto,
    );
  }

  @Delete(":id/input-fields/:fieldId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteProductInputField()
  async deleteProductInputField(
    @Param("id") id: string,
    @Param("fieldId") fieldId: string,
  ) {
    const product = await this.productsService.findOne(id);
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return this.productsService.deleteProductInputField(id, fieldId);
  }
}
