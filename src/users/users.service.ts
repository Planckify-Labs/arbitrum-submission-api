import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

@Injectable()
export class UsersService {
  private static readonly USER_SAFE_SELECT = {
    id: true,
    walletAddress: true,
    walletAddressLower: true,
    email: true,
    username: true,
    name: true,
    profileImage: true,
    authProvider: true,
    socialId: true,
    role: true,
    status: true,
    permissions: true,
    lastLoginAt: true,
    loginAttempts: true,
    lockedUntil: true,
    regionId: true,
    createdAt: true,
    updatedAt: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    return this.prisma.user.create({
      data: createUserDto,
    });
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: UsersService.USER_SAFE_SELECT,
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: UsersService.USER_SAFE_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    await this.findOne(id); // Check if user exists

    return this.prisma.user.update({
      where: { id },
      data: updateUserDto,
      select: UsersService.USER_SAFE_SELECT,
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if user exists

    await this.prisma.user.delete({
      where: { id },
    });
  }

  async findUserTransactions(id: string) {
    await this.findOne(id); // Check if user exists

    return this.prisma.transactionHistory.findMany({
      where: { userId: id },
      include: {
        token: true,
      },
    });
  }
}
