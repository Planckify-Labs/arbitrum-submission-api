import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../../decorators/roles.decorator";
import { UserRole } from "@generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      return false;
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, role: true },
    });

    if (!dbUser) {
      return false;
    }

    const hasRequiredRole = requiredRoles.includes(dbUser.role);

    if (dbUser.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    if (dbUser.role === UserRole.ADMIN) {
      const req = context.switchToHttp().getRequest();
      const path = req.path;

      if (path.includes("/users") && req.params?.id) {
        const targetUser = await this.prisma.user.findUnique({
          where: { id: req.params.id },
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
    }

    return hasRequiredRole;
  }
}
