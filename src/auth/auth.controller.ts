import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UnauthorizedException,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { VerifyDto } from "./dto/verify.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { CreateAdminDto } from "./dto/create-admin.dto";
import { GoogleLoginDto } from "./dto/google-login.dto";
import {
  GoogleChallengeResponseDto,
  LinkWalletDto,
  ResendGoogleOtpDto,
  VerifyGoogleOtpDto,
} from "./dto/google-otp.dto";
import { Roles } from "../decorators/roles.decorator";
import { UserRole } from "@generated/prisma";
import { NonceDto } from "./dto/nonce.dto";
import { Public } from "src/decorators/public.decorator";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: "Get nonce for wallet authentication" })
  @ApiResponse({
    status: 200,
    description: "Nonce generated successfully",
  })
  @Public()
  @Get("nonce/:walletAddress")
  async getNonce(
    @Param("walletAddress") walletAddress: string,
    @Query() nonceDto: NonceDto,
  ) {
    // Explicit chainSlug wins — caller told us exactly which cluster/network.
    if (nonceDto.chainSlug) {
      if (nonceDto.chainSlug.startsWith("sui-")) {
        const nonce = await this.authService.generateNonce(
          walletAddress,
          "sui",
        );
        const message = this.authService.createSiwsSuiMessage(
          walletAddress,
          nonce,
          nonceDto.chainSlug,
        );
        return { nonce, message };
      }
      if (nonceDto.chainSlug.startsWith("solana-")) {
        const nonce = await this.authService.generateNonce(
          walletAddress,
          "solana",
        );
        const message = this.authService.createSiwsMessage(
          walletAddress,
          nonce,
          nonceDto.chainSlug,
        );
        return { nonce, message };
      }
      throw new BadRequestException(
        `Unsupported chainSlug: ${nonceDto.chainSlug}`,
      );
    }

    // Defense-in-depth: auto-detect namespace from address format when
    // the caller didn't specify one. Sui canonical addresses are
    // `0x` + 64 hex chars (32 bytes); Solana addresses are base58 (no
    // 0x prefix); EVM addresses are `0x` + 40 hex chars.
    const isEvmAddress = /^0x[a-fA-F0-9]{40}$/.test(walletAddress);
    const isSuiAddress = /^0x[a-fA-F0-9]{64}$/.test(walletAddress);
    if (isSuiAddress) {
      const nonce = await this.authService.generateNonce(walletAddress, "sui");
      const message = this.authService.createSiwsSuiMessage(
        walletAddress,
        nonce,
        "sui-mainnet",
      );
      return { nonce, message };
    }
    if (!isEvmAddress) {
      const nonce = await this.authService.generateNonce(
        walletAddress,
        "solana",
      );
      const message = this.authService.createSiwsMessage(
        walletAddress,
        nonce,
        "solana-mainnet",
      );
      return { nonce, message };
    }

    const nonce = await this.authService.generateNonce(walletAddress, "eip155");
    const message = this.authService.createSiweMessage(
      walletAddress,
      nonce,
      nonceDto.chainId,
    );
    return { nonce, message };
  }

  @ApiOperation({ summary: "Verify signature and authenticate wallet" })
  @ApiResponse({
    status: 200,
    description: "Wallet authenticated successfully",
    type: AuthResponseDto,
  })
  @Public()
  @Post("verify")
  async verify(@Body() verifyDto: VerifyDto): Promise<AuthResponseDto> {
    const { message, signature } = verifyDto;
    const result = await this.authService.verifySignature(message, signature);

    if (!result.success) {
      throw new UnauthorizedException("Invalid signature");
    }

    return this.authService.login(result.address, result.namespace);
  }

  @ApiOperation({ summary: "Refresh access token" })
  @ApiResponse({
    status: 200,
    description: "Token refreshed successfully",
    type: Object,
  })
  @Public()
  @Post("refresh")
  async refresh(
    @Body() refreshTokenDto: RefreshTokenDto,
  ): Promise<{ access_token: string }> {
    return await this.authService.refresh(refreshTokenDto.refresh_token);
  }

  @ApiOperation({
    summary: "Start Google sign-in — verifies the ID token and emails a code",
    description:
      "Issues no tokens. Returns a challenge that must be exchanged via POST /auth/google/verify-otp.",
  })
  @ApiResponse({
    status: 200,
    description: "Verification code sent",
    type: GoogleChallengeResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      "Invalid Google token (INVALID_GOOGLE_TOKEN) or email conflict with an existing account (ACCOUNT_CONFLICT)",
  })
  @ApiResponse({
    status: 403,
    description: "Account is not active (ACCOUNT_INACTIVE)",
  })
  @ApiResponse({
    status: 429,
    description: "Too many verification requests for this address",
  })
  @ApiResponse({
    status: 503,
    description: "Verification email could not be sent",
  })
  @Public()
  @Post("google")
  googleLogin(
    @Body() googleLoginDto: GoogleLoginDto,
  ): Promise<GoogleChallengeResponseDto> {
    return this.authService.startGoogleLogin(
      googleLoginDto.idToken,
      googleLoginDto.platform,
    );
  }

  @ApiOperation({
    summary: "Complete Google sign-in by submitting the emailed code",
  })
  @ApiResponse({
    status: 200,
    description: "Verification successful",
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid or expired verification code (INVALID_CODE)",
  })
  @Public()
  @Post("google/verify-otp")
  verifyGoogleOtp(
    @Body() verifyGoogleOtpDto: VerifyGoogleOtpDto,
  ): Promise<AuthResponseDto> {
    return this.authService.verifyGoogleOtp(
      verifyGoogleOtpDto.challengeId,
      verifyGoogleOtpDto.code,
    );
  }

  @ApiOperation({
    summary: "Re-send the verification code for a pending challenge",
    description:
      "Rotates the code without extending the original expiry window.",
  })
  @ApiResponse({
    status: 200,
    description: "A new verification code was sent",
    type: GoogleChallengeResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      "Verification session expired or resend budget exhausted (CHALLENGE_EXPIRED)",
  })
  @Public()
  @Post("google/resend-otp")
  resendGoogleOtp(
    @Body() resendGoogleOtpDto: ResendGoogleOtpDto,
  ): Promise<GoogleChallengeResponseDto> {
    return this.authService.resendGoogleOtp(resendGoogleOtpDto.challengeId);
  }

  @ApiOperation({
    summary: "Link a wallet address to the signed-in account",
    description:
      "Records that this account owns a wallet, so a future sign-in on a new device can offer recovery instead of minting a fresh wallet. Idempotent; stores no key material. Requires a valid access token.",
  })
  @ApiResponse({ status: 201, description: "Wallet linked" })
  @Post("google/wallets")
  async linkWallet(
    @Body() linkWalletDto: LinkWalletDto,
    @Req() req: Request & { user?: { id: string } },
  ): Promise<{ linked: true }> {
    if (!req.user?.id) {
      throw new UnauthorizedException("Authentication required");
    }
    await this.authService.linkWallet(req.user.id, linkWalletDto.walletAddress);
    return { linked: true };
  }

  @ApiOperation({ summary: "Admin login with username and password" })
  @ApiResponse({
    status: 200,
    description: "Admin authenticated successfully",
    type: AuthResponseDto,
  })
  @Public()
  @Post("admin/login")
  async adminLogin(
    @Body() adminLoginDto: AdminLoginDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    const { username, password } = adminLoginDto;
    const ipAddress =
      (req.ip as string) ||
      (req.headers["x-forwarded-for"] as string) ||
      (req.headers["x-real-ip"] as string) ||
      "unknown";
    const userAgent = (req.headers["user-agent"] as string) || "unknown";
    return await this.authService.adminLogin(
      username,
      password,
      ipAddress,
      userAgent,
    );
  }

  @ApiOperation({ summary: "Create a new admin user (Super Admin only)" })
  @ApiResponse({
    status: 201,
    description: "Admin user created successfully",
  })
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Post("admin/create")
  async createAdmin(@Body() createAdminDto: CreateAdminDto) {
    const { username, password, email, name, role } = createAdminDto;
    return await this.authService.createAdminUser(
      username,
      password,
      email,
      name,
      role,
    );
  }
}
