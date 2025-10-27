import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";

interface JwtPayload {
  sub: string;
  walletAddress?: string;
  username?: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const secret = configService.get<string>("JWT_SECRET");
    if (!secret) {
      throw new Error(
        "JWT_SECRET is not defined in environment variables. Please set JWT_SECRET in your .env file.",
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        walletAddress: true,
        username: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    const normalizedPayloadWallet = payload.walletAddress?.toLowerCase();
    const normalizedUserWallet = user.walletAddress?.toLowerCase();

    const walletMismatch =
      normalizedPayloadWallet &&
      normalizedUserWallet !== normalizedPayloadWallet;
    const usernameMismatch =
      payload.username && user.username !== payload.username;

    if (walletMismatch || usernameMismatch) {
      throw new UnauthorizedException("User identity mismatch");
    }

    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException("User account is not active");
    }

    return {
      id: user.id,
      walletAddress: user.walletAddress || undefined,
      username: user.username || undefined,
      role: user.role,
    };
  }
}
