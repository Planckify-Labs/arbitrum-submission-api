import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AddressBookService } from './address-book.service';
import { CreateAddressBookDto } from './dto/create-address-book.dto';
import { UpdateAddressBookDto } from './dto/update-address-book.dto';

interface AuthenticatedRequest {
  user: {
    id: string;
    walletAddress: string;
  };
}

@Controller('address-book')
@ApiTags('address-book')
@ApiBearerAuth()
export class AddressBookController {
  constructor(private readonly addressBookService: AddressBookService) {}

  @Post()
  create(
    @Body() createAddressBookDto: CreateAddressBookDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.addressBookService.create(req.user.id, createAddressBookDto);
  }

  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    return this.addressBookService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.addressBookService.findOne(req.user.id, id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateAddressBookDto: UpdateAddressBookDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.addressBookService.update(req.user.id, id, updateAddressBookDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.addressBookService.remove(req.user.id, id);
  }
}
