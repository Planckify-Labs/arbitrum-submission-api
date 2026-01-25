import { Module } from '@nestjs/common';
import { AddressBookService } from './address-book.service';
import { AddressBookController } from './address-book.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ValkeyModule } from '../valkey/valkey.module';

@Module({
  imports: [PrismaModule, ValkeyModule],
  controllers: [AddressBookController],
  providers: [AddressBookService],
  exports: [AddressBookService],
})
export class AddressBookModule {}
