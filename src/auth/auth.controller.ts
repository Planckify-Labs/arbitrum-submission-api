import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { VerifyDto } from "./dto/verify.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { SiweMessage } from "siwe";
import {
  ApiGetNonce,
  ApiVerify,
  ApiRefresh,
  ApiGetMe,
} from "../decorators/swagger/auth.decorators";
import { NonceDto } from "./dto/nonce.dto";
import { Public } from "../decorators/public.decorator";

@Controller("auth")
@ApiTags("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get("nonce/:walletAddress")
  @ApiGetNonce()
  getNonce(
    @Param("walletAddress") walletAddress: string,
    @Query() nonceDto: NonceDto,
  ): {
    nonce: string;
    message: string;
  } {
    const nonce = this.authService.generateNonce(walletAddress);
    try {
      const message = this.authService.createSiweMessage(
        walletAddress,
        nonce,
        nonceDto.chainId,
      );
      return { nonce, message };
    } catch (error) {
      throw new BadRequestException(`Invalid wallet address: ${error.message}`);
    }
  }

  @Public()
  @Post("verify")
  @ApiVerify()
  async verify(@Body() verifyDto: VerifyDto): Promise<AuthResponseDto> {
    const { message, signature } = verifyDto;

    const isValid = await this.authService.verifySignature(message, signature);
    if (!isValid) {
      throw new UnauthorizedException("Invalid signature");
    }

    try {
      const siweMessage = new SiweMessage(message);
      const walletAddress = siweMessage.address;
      return this.authService.login(walletAddress);
    } catch (error) {
      throw new BadRequestException(`Invalid message format: ${error.message}`);
    }
  }

  @Public()
  @Post("refresh")
  @ApiRefresh()
  refresh(
    @Body() refreshTokenDto: RefreshTokenDto,
  ): Promise<{ access_token: string }> {
    return this.authService.refresh(refreshTokenDto.refresh_token);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiGetMe()
  getProfile(@Request() req) {
    return {
      id: req.user.id,
      walletAddress: req.user.walletAddress,
    };
  }
}
