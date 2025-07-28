import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { UserRole } from "@generated/prisma";

@Injectable()
export class UserResourceGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.params.id;
    const currentUser = request.user;

    if (!userId || currentUser.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    if (currentUser.role === UserRole.ADMIN) {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (
        targetUser &&
        (targetUser.role === UserRole.ADMIN ||
          targetUser.role === UserRole.SUPER_ADMIN)
      ) {
        throw new ForbiddenException(
          "Admin users cannot manage other admin users",
        );
      }
    }

    return true;
  }
}
