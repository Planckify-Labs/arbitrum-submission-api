import {
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
    const nonce = await this.authService.generateNonce(walletAddress);
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
    const isValid = await this.authService.verifySignature(message, signature);

    if (!isValid) {
      throw new UnauthorizedException("Invalid signature");
    }

    const addressMatch = message.match(/0x[a-fA-F0-9]{40}/i);
    if (!addressMatch) {
      throw new UnauthorizedException(
        "Could not extract wallet address from message",
      );
    }
    const walletAddress = addressMatch[0];

    return this.authService.login(walletAddress);
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
