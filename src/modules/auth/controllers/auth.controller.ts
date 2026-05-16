import { Controller, Post, Body, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { WeappLoginDto } from '../dto/weapp-login.dto';
import { WeappBindDto } from '../dto/weapp-bind.dto';
import { Public, AllowAuthenticated } from '~/core/decorators';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AuthenticatedUser } from '../strategies/jwt.strategy';
import { IpUtil } from '~/common/utils';
import { MessageResponseDto } from '~/common/dto/message-response.dto';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登录' })
  @ApiBody({ type: LoginDto })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '用户名或密码错误' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ipAddress = IpUtil.getRealIp(
      req,
      this.configService.get<boolean>('app.trustProxy', false),
    );
    const userAgent = req.headers['user-agent'];

    return this.authService.login(dto, ipAddress, userAgent);
  }

  @Post('weapp/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信小程序静默登录' })
  @ApiBody({ type: WeappLoginDto })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '微信账号未绑定或登录凭证无效' })
  async weappLogin(@Body() dto: WeappLoginDto, @Req() req: Request) {
    const ipAddress = IpUtil.getRealIp(
      req,
      this.configService.get<boolean>('app.trustProxy', false),
    );
    const userAgent = req.headers['user-agent'];

    return this.authService.loginWithWeappCode(dto, ipAddress, userAgent);
  }

  @Post('weapp/bind')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信小程序绑定现有账号' })
  @ApiBody({ type: WeappBindDto })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '用户名密码错误或微信登录凭证无效' })
  @ApiForbiddenResponse({ description: '账号状态不可用' })
  async weappBind(@Body() dto: WeappBindDto, @Req() req: Request) {
    const ipAddress = IpUtil.getRealIp(
      req,
      this.configService.get<boolean>('app.trustProxy', false),
    );
    const userAgent = req.headers['user-agent'];

    return this.authService.bindWeappAccount(dto, ipAddress, userAgent);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新令牌' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '无效的刷新令牌' })
  async refreshToken(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @Post('logout')
  @AllowAuthenticated()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登出' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body('refreshToken') refreshToken?: string,
  ) {
    await this.authService.logout(user.id, refreshToken, user.sessionId);
    return MessageResponseDto.of('登出成功');
  }
}
