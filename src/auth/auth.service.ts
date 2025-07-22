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
          authProvider: "WALLET",
        },
      });
    }

    const payload = {
      sub: user.id,
      walletAddress: walletAddress.toLowerCase(),
    };

    return {
      access_token: this.jwtService.sign(payload, {
        expiresIn: process.env.JWT_EXPIRATION_TIME,
      }),
      refresh_token: this.jwtService.sign(
        { sub: user.id, type: "refresh" },
        { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION_TIME },
      ),
      user: {
        id: user.id,
        walletAddress: user.walletAddress || "",
      },
    };
  }

  async refresh(refreshToken: string): Promise<{ access_token: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken);

      if (payload.type !== "refresh") {
        throw new UnauthorizedException("Invalid token type");
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      return {
        access_token: this.jwtService.sign(
          {
            sub: user.id,
            walletAddress: user.walletAddress || "",
          },
          { expiresIn: process.env.JWT_EXPIRATION_TIME },
        ),
      };
    } catch (error) {
      this.logger.error(`Refresh token verification failed: ${error.message}`);
      throw new UnauthorizedException("Invalid refresh token");
    }
  }
}
