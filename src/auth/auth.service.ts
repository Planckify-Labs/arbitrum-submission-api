import { randomBytes } from "crypto";
import { AuthProvider, UserRole, UserStatus } from "@generated/prisma";
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { OAuth2Client, TokenPayload } from "google-auth-library";
import { SiweMessage } from "siwe";
import { PrismaService } from "../prisma/prisma.service";
import { NonceCacheService } from "../valkey/services/nonce-cache.service";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { SiwsService } from "./siws/siws.service";
import { chainSlugToCluster, SiwsCluster } from "./siws/siws-message";

export type AddressNamespace = "eip155" | "solana";

export interface VerifyDispatchResult {
  success: boolean;
  address: string;
  namespace: AddressNamespace;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly defaultChainId: number;
  private readonly nonceExpireMinutes: number;
  private readonly googleClient: OAuth2Client;
  private readonly googleClientIds: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly nonceCacheService: NonceCacheService,
    private readonly siwsService: SiwsService,
  ) {
    this.defaultChainId = this.configService.get<number>("CHAIN_ID", 1);
    this.nonceExpireMinutes = parseInt(
      this.configService.get<string>("NONCE_EXPIRE_TIME_MINUTES", "5"),
      10,
    );

    this.googleClientIds = [
      this.configService.get<string>("GOOGLE_CLIENT_ID_IOS"),
      this.configService.get<string>("GOOGLE_CLIENT_ID_ANDROID"),
      this.configService.get<string>("GOOGLE_CLIENT_ID_WEB"),
    ].filter((id): id is string => !!id);

    this.googleClient = new OAuth2Client();
  }

  async generateNonce(
    walletAddress: string,
    namespace: AddressNamespace = "eip155",
  ): Promise<string> {
    const nonce = randomBytes(32).toString("hex");
    await this.nonceCacheService.setNonce(namespace, walletAddress, nonce);
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

  createSiwsMessage(
    walletAddress: string,
    nonce: string,
    chainSlug: string,
  ): string {
    const cluster: SiwsCluster = chainSlugToCluster(chainSlug);
    const domain = this.configService.get<string>("SIWE_DOMAIN");
    const uri = this.configService.get<string>("SIWE_URI");
    const statement = this.configService.get<string>("SIWE_STATEMENT");
    const issuedAt = new Date();
    const expiration = new Date(
      issuedAt.getTime() + this.nonceExpireMinutes * 60 * 1000,
    );

    if (!domain || !uri) {
      throw new BadRequestException(
        "SIWS environment (SIWE_DOMAIN/SIWE_URI) is not configured",
      );
    }

    return this.siwsService.buildMessage({
      domain,
      address: walletAddress,
      statement,
      uri,
      version: "1",
      chainId: cluster,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expiration.toISOString(),
    });
  }

  async verifySignature(
    message: string,
    signature: string,
  ): Promise<VerifyDispatchResult> {
    const empty: VerifyDispatchResult = {
      success: false,
      address: "",
      namespace: "eip155",
    };

    try {
      if (message.includes("wants you to sign in with your Solana account:")) {
        const result = await this.siwsService.verify(message, signature);
        if (!result.success) return empty;
        return {
          success: true,
          address: result.address,
          namespace: "solana",
        };
      }

      if (
        message.includes("wants you to sign in with your Ethereum account:")
      ) {
        const siweMessage = new SiweMessage(message);
        const { success, data: fields } = await siweMessage.verify({
          signature,
        });

        if (!success) return empty;

        if (
          fields.domain !== this.configService.get<string>("SIWE_DOMAIN")
        ) {
          this.logger.error(`Domain mismatch: ${fields.domain}`);
          return empty;
        }

        const address = fields.address;
        const cachedData = await this.nonceCacheService.getNonce(
          "eip155",
          address,
        );
        if (!cachedData || cachedData.nonce !== fields.nonce) return empty;

        await this.nonceCacheService.deleteNonce("eip155", address);
        return {
          success: true,
          address,
          namespace: "eip155",
        };
      }

      return empty;
    } catch (error) {
      this.logger.error(`Signature verification failed: ${error.message}`);
      return empty;
    }
  }

  async login(
    address: string,
    namespace: AddressNamespace,
  ): Promise<AuthResponseDto> {
    const inputLower =
      namespace === "eip155" ? address.toLowerCase() : address;

    let user = await this.prisma.user.findUnique({
      where: { walletAddressLower: inputLower },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          walletAddress: address,
          walletAddressLower: inputLower,
          authProvider: AuthProvider.WALLET,
        },
      });
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User account is not active");
    }

    const payload = {
      sub: user.id,
      walletAddress: user.walletAddress ?? address,
      addressNamespace: namespace,
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

  async googleLogin(
    idToken: string,
    platform?: string,
  ): Promise<AuthResponseDto> {
    // 1. Verify the Google ID token
    const payload = await this.verifyGoogleToken(idToken, platform);

    if (!payload || !payload.email) {
      throw new UnauthorizedException("Invalid Google token");
    }

    const { email, sub: googleId, name, picture } = payload;

    // 2. Check if user exists by Google socialId
    let user = await this.prisma.user.findFirst({
      where: {
        authProvider: AuthProvider.GOOGLE,
        socialId: googleId,
      },
    });

    // 3. If no user found by socialId, check by email
    if (!user) {
      const existingUserByEmail = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existingUserByEmail) {
        // Email exists with different auth provider - for now, throw conflict
        if (existingUserByEmail.authProvider !== AuthProvider.GOOGLE) {
          throw new BadRequestException(
            "An account with this email already exists. Please sign in using your original method.",
          );
        }
        // Update socialId if it was somehow missing
        user = await this.prisma.user.update({
          where: { id: existingUserByEmail.id },
          data: { socialId: googleId },
        });
      } else {
        // 4. Create new user
        user = await this.prisma.user.create({
          data: {
            email: email.toLowerCase(),
            name: name || null,
            profileImage: picture || null,
            authProvider: AuthProvider.GOOGLE,
            socialId: googleId,
            status: UserStatus.ACTIVE,
          },
        });
      }
    }

    // 5. Check user status
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User account is not active");
    }

    // 6. Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 7. Generate JWT tokens (same format as SIWE auth)
    const tokenPayload = {
      sub: user.id,
      email: user.email,
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
      access_token: this.jwtService.sign(tokenPayload, {
        expiresIn: jwtExpirationTime,
      }),
      refresh_token: this.jwtService.sign(
        { sub: user.id, type: "refresh" },
        { expiresIn: refreshTokenExpirationTime },
      ),
      user: {
        id: user.id,
        email: user.email || undefined,
        name: user.name || undefined,
        role: user.role,
      },
    };
  }

  private async verifyGoogleToken(
    idToken: string,
    platform?: string,
  ): Promise<TokenPayload | null> {
    try {
      // Determine which client ID to use based on platform
      // Note: Android uses Web Client ID for token verification
      let audience = this.googleClientIds;
      if (platform === "ios") {
        const iosClientId = this.configService.get<string>(
          "GOOGLE_CLIENT_ID_IOS",
        );
        if (iosClientId) audience = [iosClientId];
      } else if (platform === "android") {
        // Android tokens are issued with Web Client ID as audience
        const webClientId = this.configService.get<string>(
          "GOOGLE_CLIENT_ID_WEB",
        );
        if (webClientId) audience = [webClientId];
      }

      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: audience.length > 0 ? audience : undefined,
      });

      return ticket.getPayload() || null;
    } catch (error) {
      this.logger.error(`Google token verification failed: ${error.message}`);
      return null;
    }
  }

  async adminLogin(
    username: string,
    password: string,
    ipAddress: string = "N/A",
    userAgent: string = "N/A",
  ): Promise<AuthResponseDto> {
    let user;
    if (username.includes("@")) {
      user = await this.prisma.user.findUnique({
        where: { email: username },
      });
      if (!user) {
        user = await this.prisma.user.findUnique({
          where: { username },
        });
      }
    } else {
      user = await this.prisma.user.findUnique({
        where: { username },
      });
      if (!user) {
        user = await this.prisma.user.findUnique({
          where: { email: username },
        });
      }
    }

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
        ipAddress,
        userAgent,
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
    // Only wrap JWT verification in try-catch — DB and other errors should
    // propagate as 500 so clients can distinguish "bad token" (401) from
    // "server unavailable" (5xx) and not incorrectly clear valid tokens.
    interface RefreshTokenPayload {
      sub: string;
      type: string;
    }

    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify(refreshToken) as RefreshTokenPayload;
    } catch (error) {
      this.logger.error(`Refresh token verification failed: ${error.message}`);
      throw new UnauthorizedException("Invalid refresh token");
    }

    if (payload.type !== "refresh") {
      throw new UnauthorizedException("Invalid token type");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        walletAddress: true,
        walletAddressLower: true,
        username: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      // User row was deleted (e.g. DB reset). The refresh token is
      // cryptographically valid but the account no longer exists.
      // Use a specific code so clients can distinguish this from a bad token.
      throw new UnauthorizedException({
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    const tokenPayload: Record<string, unknown> = {
      sub: user.id,
      role: user.role,
    };

    if (user.walletAddress) {
      tokenPayload.walletAddress = user.walletAddress;
      // Infer namespace: EVM is 0x-prefixed hex; anything else is Solana base58.
      tokenPayload.addressNamespace = /^0x[a-fA-F0-9]{40}$/.test(
        user.walletAddress,
      )
        ? "eip155"
        : "solana";
    } else if (user.email) {
      tokenPayload.email = user.email;
    } else if (user.username) {
      tokenPayload.username = user.username;
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
  }
}
