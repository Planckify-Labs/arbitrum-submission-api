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
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import {
  ApiCreateUser,
  ApiDeleteUser,
  ApiGetUser,
  ApiGetUsers,
  ApiGetUserTransactions,
  ApiUpdateUser,
} from "../decorators/swagger/user.decorators";

@Controller("users")
@ApiTags("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiCreateUser()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @ApiGetUsers()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(":id")
  @ApiGetUser()
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Put(":id")
  @ApiUpdateUser()
  update(@Param("id") id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteUser()
  remove(@Param("id") id: string) {
    return this.usersService.remove(id);
  }

  @Get(":id/transactions")
  @ApiGetUserTransactions()
  findUserTransactions(@Param("id") id: string) {
    return this.usersService.findUserTransactions(id);
  }
}
