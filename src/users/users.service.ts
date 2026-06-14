import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UsersQueryDto } from "./dto/users-query.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { Prisma, UserStatus } from "@generated/prisma";

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

  create(createUserDto: CreateUserDto) {
    return this.prisma.user.create({
      data: createUserDto,
    });
  }

  async findAll(query: UsersQueryDto = {}) {
    const { cursor, take = 50, role, status, search, skip } = query;
    const useSkip = typeof skip === "number" && skip > 0;

    const where: Prisma.UserWhereInput = {
      ...(role && { role }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { username: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
          { walletAddress: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const findArgs = {
      take,
      skip: useSkip ? skip : cursor ? 1 : 0,
      cursor: useSkip ? undefined : cursor ? { id: cursor } : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        ...findArgs,
        where,
        orderBy: { createdAt: "desc" },
        select: UsersService.USER_SAFE_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total };
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

  async softDelete(id: string) {
    await this.findOne(id);

    await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.INACTIVE },
    });
  }

  async findUserTransactions(
    id: string,
    pagination: CursorPaginationDto = {},
  ) {
    await this.findOne(id); // Check if user exists

    const { cursor, take = 50 } = pagination;

    let cursorDate: Date | undefined;
    if (cursor) {
      const cursorTx = await this.prisma.transactionHistory.findFirst({
        where: { id: cursor },
        select: { createdAt: true },
      });
      cursorDate = cursorTx?.createdAt;
    }

    return this.prisma.transactionHistory.findMany({
      where: {
        userId: id,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
      take,
      include: {
        token: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
