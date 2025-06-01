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
} from "@nestjs/common";
import { ProductsService } from "./products.service";
import { ApiTags } from "@nestjs/swagger";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import {
  ApiCreateProduct,
  ApiDeleteProduct,
  ApiGetProduct,
  ApiGetProducts,
  ApiGetProductsByCategory,
  ApiGetCategories,
  ApiGetProductByCode,
  ApiUpdateProduct,
} from "../decorators/swagger/product.decorators";

@Controller("products")
@ApiTags("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiGetProducts()
  findAll() {
    return this.productsService.findAll();
  }

  @Get("categories")
  @ApiGetCategories()
  findAllCategories() {
    return this.productsService.findAllCategories();
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
}
