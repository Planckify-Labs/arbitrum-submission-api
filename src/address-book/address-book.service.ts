import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddressBookCacheService } from '../valkey/services/address-book-cache.service';
import { CreateAddressBookDto } from './dto/create-address-book.dto';
import { UpdateAddressBookDto } from './dto/update-address-book.dto';

@Injectable()
export class AddressBookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addressBookCache: AddressBookCacheService,
  ) {}

  async create(userId: string, dto: CreateAddressBookDto) {
    const existing = await this.prisma.addressBook.findUnique({
      where: {
        userId_address: {
          userId,
          address: dto.address,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Address ${dto.address} already exists in your address book`,
      );
    }

    const entry = await this.prisma.addressBook.create({
      data: {
        userId,
        ...dto,
      },
    });

    await this.addressBookCache.invalidateUserAddressBook(userId);
    return entry;
  }

  async findAll(userId: string) {
    return this.addressBookCache.getUserAddressBook(userId, () =>
      this.prisma.addressBook.findMany({
        where: { userId },
        orderBy: { label: 'asc' },
      }),
    );
  }

  async findOne(userId: string, id: string) {
    const entry = await this.addressBookCache.getById(id, () =>
      this.prisma.addressBook.findUnique({
        where: { id },
      }),
    );

    if (!entry || entry.userId !== userId) {
      throw new NotFoundException(`Address book entry with ID ${id} not found`);
    }

    return entry;
  }

  async update(userId: string, id: string, dto: UpdateAddressBookDto) {
    await this.findOne(userId, id);

    const result = await this.prisma.addressBook.update({
      where: { id },
      data: dto,
    });

    await this.addressBookCache.invalidateEntry(id, userId);
    return result;
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);

    await this.prisma.addressBook.delete({
      where: { id },
    });

    await this.addressBookCache.invalidateEntry(id, userId);
  }
}
