import { PartialType } from '@nestjs/swagger';
import { CreateAddressBookDto } from './create-address-book.dto';

export class UpdateAddressBookDto extends PartialType(CreateAddressBookDto) {}
