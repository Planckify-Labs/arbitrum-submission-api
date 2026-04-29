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
  UseGuards,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UsersQueryDto } from "./dto/users-query.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../decorators/roles.decorator";
import { UserRole } from "@generated/prisma";
import { UserResourceGuard } from "./guards/user-resource.guard";
import { UserResponseDto } from "./dto/user-response.dto";

@Controller("users")
@ApiTags("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Create a new user (Admin only)" })
  @ApiResponse({
    status: 201,
    description: "User created successfully",
    type: UserResponseDto,
  })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Get all users (Admin only)" })
  @ApiResponse({
    status: 200,
    description: "Returns all users",
    type: [UserResponseDto],
  })
  async findAll(
    @Query() query: UsersQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.usersService.findAll(query);
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get(":id")
  @UseGuards(UserResourceGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Get a user by ID (Admin only)" })
  @ApiResponse({
    status: 200,
    description: "Returns the user",
    type: UserResponseDto,
  })
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Put(":id")
  @UseGuards(UserResourceGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Update a user (Admin only)" })
  @ApiResponse({
    status: 200,
    description: "User updated successfully",
    type: UserResponseDto,
  })
  update(@Param("id") id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(":id")
  @UseGuards(UserResourceGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Soft-delete a user (Admin)" })
  @ApiResponse({
    status: 204,
    description: "User deactivated successfully",
  })
  remove(@Param("id") id: string) {
    return this.usersService.softDelete(id);
  }

  @Delete(":id/hard")
  @UseGuards(UserResourceGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Hard-delete a user (Super Admin only)" })
  @ApiResponse({
    status: 204,
    description: "User permanently deleted",
  })
  hardRemove(@Param("id") id: string) {
    return this.usersService.remove(id);
  }

  @Get(":id/transactions")
  @UseGuards(UserResourceGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Get user transactions (Admin only)" })
  @ApiResponse({
    status: 200,
    description: "Returns user transactions",
    type: [Object],
  })
  findUserTransactions(
    @Param("id") id: string,
    @Query() pagination: CursorPaginationDto,
  ) {
    return this.usersService.findUserTransactions(id, pagination);
  }
}
