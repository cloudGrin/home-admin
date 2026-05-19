import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { MoreThan, Repository } from 'typeorm';
import { UserService } from '~/modules/user/services/user.service';
import { RefreshTokenEntity } from '../entities/refresh-token.entity';
import { JwtPayload } from '../services/auth.service';

export interface AuthenticatedUser {
  id: number;
  username: string;
  email: string;
  roles: string[];
  sessionId: string;
  /** 是否为超级管理员（拥有 super_admin 角色） */
  isSuperAdmin?: boolean;
  /** 主要角色码（用于快速判断） */
  roleCode?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly userService: UserService,
    configService: ConfigService,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.secret')!,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    let user;
    try {
      user = await this.userService.findUserById(payload.sub);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new UnauthorizedException('User not found');
      }
      throw error;
    }

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('User account is not active');
    }

    const payloadTokenVersion = payload.tokenVersion ?? 0;
    const userTokenVersion = user.tokenVersion ?? 0;
    if (payloadTokenVersion !== userTokenVersion) {
      throw new UnauthorizedException('Access token has been revoked');
    }

    if (!payload.sessionId) {
      throw new UnauthorizedException('Access token session is missing');
    }

    const activeSessionCount = await this.refreshTokenRepository.count({
      where: {
        userId: payload.sub,
        deviceId: payload.sessionId,
        isRevoked: false,
        expiresAt: MoreThan(new Date()),
      },
    });
    if (activeSessionCount === 0) {
      throw new UnauthorizedException('Access token session has been revoked');
    }

    // 提取角色码
    const roleCodes = user.roles?.map((role) => role.code) || [];

    // 判断是否为超级管理员
    const isSuperAdmin = roleCodes.includes('super_admin');

    // 获取主要角色码（第一个角色或 super_admin）
    const roleCode = isSuperAdmin ? 'super_admin' : roleCodes[0];

    const authUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      roles: roleCodes,
      sessionId: payload.sessionId || '',
      isSuperAdmin,
      roleCode,
    };

    return authUser;
  }
}
