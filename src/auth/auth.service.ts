import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { SiweMessage } from "siwe";
import { randomBytes } from "crypto";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { UserRole, UserStatus, AuthProvider } from "../../generated/prisma";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly nonceCache = new Map<
    string,
    { nonce: string; expires: Date }
  >();
  private readonly defaultChainId: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.defaultChainId = this.configService.get<number>("CHAIN_ID", 1);
  }

  generateNonce(walletAddress: string): string {
    const nonce = randomBytes(32).toString("hex");
    const nonceExpireMinutes = parseInt(
      this.configService.get<string>("NONCE_EXPIRE_TIME_MINUTES") || "5",
      10,
    );
    const expires = new Date(Date.now() + nonceExpireMinutes * 60 * 1000);

    this.nonceCache.set(walletAddress.toLowerCase(), { nonce, expires });
    return nonce;
  }

  createSiweMessage(
    walletAddress: string,
    nonce: string,
    chainId?: number,
  ): string {
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/i.test(walletAddress)) {
      throw new BadRequestException("Invalid Ethereum wallet address format");
    }

    const domain = this.configService.get<string>("SIWE_DOMAIN");
    const uri = this.configService.get<string>("SIWE_URI");
    const statement = this.configService.get<string>("SIWE_STATEMENT");
    const issuedAt = new Date().toISOString();

    try {
      const message = new SiweMessage({
        domain,
        address: walletAddress,
        statement,
        uri,
        version: "1",
        chainId: chainId || this.defaultChainId,
        nonce,
        issuedAt,
      });

      return message.prepareMessage();
    } catch (error) {
      this.logger.error(`Failed to create SIWE message: ${error.message}`);
      throw new BadRequestException(
        `Failed to create authentication message: ${error.message}`,
      );
    }
  }

  async verifySignature(message: string, signature: string): Promise<boolean> {
    try {
      const siweMessage = new SiweMessage(message);
      const { success, data: fields } = await siweMessage.verify({ signature });

      if (!success) {
        return false;
      }

      if (fields.domain !== this.configService.get<string>("SIWE_DOMAIN")) {
        this.logger.error(`Domain mismatch: ${fields.domain}`);
        return false;
      }

      const walletAddress = fields.address.toLowerCase();
      const cachedData = this.nonceCache.get(walletAddress);

      if (
        !cachedData ||
        cachedData.nonce !== fields.nonce ||
        cachedData.expires < new Date()
      ) {
        return false;
      }

      this.nonceCache.delete(walletAddress);
      return true;
    } catch (error) {
      this.logger.error(`Signature verification failed: ${error.message}`);
      return false;
    }
  }

  async login(walletAddress: string): Promise<AuthResponseDto> {
    let user = await this.prisma.user.findUnique({
      where: { walletAddress: walletAddress.toLowerCase() },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          walletAddress: walletAddress.toLowerCase(),
          authProvider: AuthProvider.WALLET,
        },
      });
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User account is not active");
    }

    const payload = {
      sub: user.id,
      walletAddress: walletAddress.toLowerCase(),
      role: user.role,
    };

    const jwtExpirationTime = this.configService.get<string>(
      "JWT_EXPIRATION_TIME",
      "1h",
    );
    const refreshTokenExpirationTime = this.configService.get<string>(
      "REFRESH_TOKEN_EXPIRATION_TIME",
      "7d",
    );

    return {
      access_token: this.jwtService.sign(payload, {
        expiresIn: jwtExpirationTime,
      }),
      refresh_token: this.jwtService.sign(
        { sub: user.id, type: "refresh" },
        { expiresIn: refreshTokenExpirationTime },
      ),
      user: {
        id: user.id,
        walletAddress: user.walletAddress || "",
        role: user.role,
      },
    };
  }

  async adminLogin(
    username: string,
    password: string,
  ): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User account is not active");
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        "Account is locked. Please try again later.",
      );
    }

    let isPasswordValid = false;
    try {
      if (!user.password) {
        throw new UnauthorizedException("Invalid credentials");
      }
      isPasswordValid = await argon2.verify(user.password, password);
    } catch (error) {
      this.logger.error(`Password verification failed: ${error.message}`);
      throw new UnauthorizedException("Invalid credentials");
    }

    if (!isPasswordValid) {
      const maxAttempts = this.configService.get<number>(
        "MAX_LOGIN_ATTEMPTS",
        5,
      );
      const lockDurationMinutes = this.configService.get<number>(
        "ACCOUNT_LOCK_DURATION_MINUTES",
        30,
      );

      const updatedAttempts = user.loginAttempts + 1;
      let lockedUntil = user.lockedUntil;

      if (updatedAttempts >= maxAttempts) {
        lockedUntil = new Date(Date.now() + lockDurationMinutes * 60 * 1000);
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          loginAttempts: updatedAttempts,
          lockedUntil,
        },
      });

      throw new UnauthorizedException("Invalid credentials");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    await this.prisma.adminAuditLog.create({
      data: {
        adminUser: { connect: { id: user.id } },
        action: "LOGIN",
        resource: "AUTH",
        ipAddress: "N/A",
        userAgent: "N/A",
      },
    });

    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };

    const jwtExpirationTime = this.configService.get<string>(
      "JWT_EXPIRATION_TIME",
      "1h",
    );
    const refreshTokenExpirationTime = this.configService.get<string>(
      "REFRESH_TOKEN_EXPIRATION_TIME",
      "7d",
    );

    return {
      access_token: this.jwtService.sign(payload, {
        expiresIn: jwtExpirationTime,
      }),
      refresh_token: this.jwtService.sign(
        { sub: user.id, type: "refresh" },
        { expiresIn: refreshTokenExpirationTime },
      ),
      user: {
        id: user.id,
        username: user.username || undefined,
        role: user.role,
      },
    };
  }

  async createAdminUser(
    username: string,
    password: string,
    email: string,
    name: string,
    role: UserRole = UserRole.ADMIN,
  ) {
    const hashedPassword = await argon2.hash(password);

    return this.prisma.user.create({
      data: {
        username,
        email,
        name,
        password: hashedPassword,
        role,
        authProvider: AuthProvider.ADMIN_CREDENTIALS,
        status: UserStatus.ACTIVE,
      },
    });
  }

  async refresh(refreshToken: string): Promise<{ access_token: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken);

      if (payload.type !== "refresh") {
        throw new UnauthorizedException("Invalid token type");
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          walletAddress: true,
          username: true,
          role: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      const tokenPayload = {
        sub: user.id,
        role: user.role,
      };

      if (user.walletAddress) {
        tokenPayload["walletAddress"] = user.walletAddress;
      } else if (user.username) {
        tokenPayload["username"] = user.username;
      }

      const jwtExpirationTime = this.configService.get<string>(
        "JWT_EXPIRATION_TIME",
        "1h",
      );

      return {
        access_token: this.jwtService.sign(tokenPayload, {
          expiresIn: jwtExpirationTime,
        }),
      };
    } catch (error) {
      this.logger.error(`Refresh token verification failed: ${error.message}`);
      throw new UnauthorizedException("Invalid refresh token");
    }
  }
}
