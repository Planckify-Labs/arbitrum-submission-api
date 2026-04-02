import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../prisma/prisma.service";

interface JwtPayload {
  sub: string;
  walletAddress?: string;
  username?: string;
  email?: string;
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
        email: true,
        role: true,
        status: true,
        authProvider: true,
      },
    });

    if (!user) {
      // The JWT is cryptographically valid but the user row no longer exists
      // (e.g. after a DB reset). Use a specific code so clients can distinguish
      // this from an invalid/expired token and avoid unnecessarily clearing tokens.
      throw new UnauthorizedException({
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    // Identity validation based on auth type
    const normalizedPayloadWallet = payload.walletAddress?.toLowerCase();
    const normalizedUserWallet = user.walletAddress?.toLowerCase();
    const normalizedPayloadEmail = payload.email?.toLowerCase();
    const normalizedUserEmail = user.email?.toLowerCase();

    const walletMismatch =
      normalizedPayloadWallet &&
      normalizedUserWallet !== normalizedPayloadWallet;
    const usernameMismatch =
      payload.username && user.username !== payload.username;
    const emailMismatch =
      normalizedPayloadEmail && normalizedUserEmail !== normalizedPayloadEmail;

    if (walletMismatch || usernameMismatch || emailMismatch) {
      throw new UnauthorizedException({
        message: "User identity mismatch",
        code: "IDENTITY_MISMATCH",
      });
    }

    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException({
        message: "User account is not active",
        code: "USER_INACTIVE",
      });
    }

    return {
      id: user.id,
      walletAddress: user.walletAddress || undefined,
      username: user.username || undefined,
      email: user.email || undefined,
      role: user.role,
      authProvider: user.authProvider,
    };
  }
}
