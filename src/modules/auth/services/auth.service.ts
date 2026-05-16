import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { TooManyRequestsException } from '../exceptions/too-many-requests.exception';
import { ConfigService } from '@nestjs/config';
import { LessThan, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { LoggerService } from '~/shared/logger/logger.service';
import { CacheService } from '~/shared/cache/cache.service';
import { UserEntity } from '~/modules/user/entities/user.entity';
import { UserService } from '~/modules/user/services/user.service';
import { RefreshTokenEntity } from '../entities/refresh-token.entity';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { WeappLoginDto } from '../dto/weapp-login.dto';
import { WeappBindDto } from '../dto/weapp-bind.dto';
import { UserStatus } from '~/common/enums/user.enum';
import { StringUtil } from '~/common/utils';
import { getExpiresInSeconds, hashRefreshToken } from './token-revocation.util';

export interface JwtPayload {
  sub: number;
  username: string;
  email: string;
  type: 'access' | 'refresh';
  sessionId?: string;
  jti?: string; // JWT ID, 确保token唯一性
  iat?: number;
  tokenVersion?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}

export interface AuthUserResponse {
  id: number;
  username: string;
  email: string;
  realName?: string;
  nickname?: string;
  avatar?: string;
  phone?: string;
  status: UserStatus;
  roles: Array<{
    id: number;
    code: string;
    name: string;
  }>;
  permissions: string[];
  isSuperAdmin: boolean;
  roleCode?: string;
}

export interface AuthResponse {
  user: AuthUserResponse;
  tokens: AuthTokens;
}

interface WeappSessionResponse {
  openid?: string;
  errcode?: number;
  errmsg?: string;
}

@Injectable()
export class AuthService {
  private readonly accessTokenSecret: string;
  private readonly accessTokenExpiresIn: string;
  private readonly refreshTokenSecret: string;
  private readonly refreshTokenExpiresIn: string;

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly cache: CacheService,
    private readonly userService: UserService,
    private readonly httpService: HttpService,
  ) {
    this.accessTokenSecret = this.configService.get('jwt.secret') || 'default-secret';
    this.accessTokenExpiresIn = this.configService.get('jwt.expiresIn') || '7d';
    this.refreshTokenSecret =
      this.configService.get('jwt.refreshSecret') || 'default-refresh-secret';
    this.refreshTokenExpiresIn = this.configService.get('jwt.refreshExpiresIn') || '30d';
  }

  /**
   * 用户登录
   */
  async login(dto: LoginDto, ipAddress?: string, userAgent?: string): Promise<AuthResponse> {
    const user = await this.validateUserCredentials(dto, ipAddress, userAgent);
    return this.createAuthResponse(user, ipAddress, userAgent);
  }

  async loginWithWeappCode(
    dto: WeappLoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    const openid = await this.resolveWeappOpenid(dto.code);
    const user = await this.userRepository.findOne({
      where: { weappOpenid: openid },
      relations: ['roles', 'roles.permissions'],
    });

    if (!user) {
      throw new UnauthorizedException('微信账号未绑定');
    }

    this.ensureUserCanLogin(user, user.username, ipAddress, userAgent);

    return this.createAuthResponse(user, ipAddress, userAgent);
  }

  async bindWeappAccount(
    dto: WeappBindDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    const openid = await this.resolveWeappOpenid(dto.code);
    const boundUser = await this.userRepository.findOne({
      where: { weappOpenid: openid },
      relations: ['roles'],
    });

    if (boundUser) {
      throw new ConflictException('该微信账号已绑定其他用户');
    }

    const user = await this.validateUserCredentials(
      { account: dto.account, password: dto.password },
      ipAddress,
      userAgent,
    );

    if (user.weappOpenid && user.weappOpenid !== openid) {
      throw new ConflictException('该账号已绑定其他微信账号');
    }

    await this.userRepository.update(
      { id: user.id },
      {
        weappOpenid: openid,
        weappBoundAt: new Date(),
      },
    );

    return this.createAuthResponse(user, ipAddress, userAgent);
  }

  private async validateUserCredentials(
    dto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<UserEntity> {
    // 1. 暴力破解防护：检查IP限制
    if (ipAddress) {
      const ipKey = `login:attempts:ip:${ipAddress}`;
      const ipAttempts = (await this.cache.get<number>(ipKey)) || 0;

      if (ipAttempts >= 10) {
        this.emitLoginFailure(dto.account, ipAddress, userAgent, 'IP登录失败次数过多');
        throw new TooManyRequestsException('该IP登录失败次数过多，请30分钟后再试');
      }
    }

    const { account, password: inputPassword } = dto;

    // 2. 查找用户
    const user = await this.findUserForLogin(account);

    if (!user) {
      await this.recordIpLoginFailure(ipAddress);
      this.emitLoginFailure(account, ipAddress, userAgent, '用户不存在');
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 3. 根据用户角色确定锁定策略
    const isSuperAdmin = user.roles?.some((role) => role.code === 'super_admin');
    const maxAttempts = isSuperAdmin ? 10 : 5;
    const lockMinutes = isSuperAdmin ? 10 : 30;
    const lockTtl = lockMinutes * 60;

    // 4. 暴力破解防护：检查用户名级别缓存（根据角色动态阈值）
    const userKey = `login:attempts:user:${dto.account}`;
    const userAttempts = (await this.cache.get<number>(userKey)) || 0;

    if (userAttempts >= maxAttempts) {
      this.emitLoginFailure(account, ipAddress, userAgent, '用户名登录失败次数过多');
      throw new TooManyRequestsException(`该账户登录失败次数过多，请${lockMinutes}分钟后再试`);
    }

    this.ensureUserCanLogin(user, account, ipAddress, userAgent);

    // 5. 验证密码
    const isPasswordValid = await user.validatePassword(inputPassword);

    if (!isPasswordValid) {
      // 记录失败次数到缓存（暴力破解防护，根据角色设置不同的过期时间）
      if (ipAddress) {
        const ipKey = `login:attempts:ip:${ipAddress}`;
        await this.cache.incr(ipKey, 30 * 60);
      }
      await this.cache.incr(userKey, lockTtl); // 用户级别：根据角色动态设置

      // 增加数据库中的登录失败次数
      user.incrementLoginAttempts();
      await this.userRepository.save(user);

      // 检查是否达到锁定阈值
      if (user.loginAttempts >= maxAttempts) {
        this.emitLoginFailure(account, ipAddress, userAgent, '密码错误次数过多');
        throw new UnauthorizedException(`密码错误次数过多，账户已被锁定${lockMinutes}分钟`);
      }

      this.emitLoginFailure(account, ipAddress, userAgent, '密码错误');
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 登录成功：清除失败计数
    if (ipAddress) {
      const ipKey = `login:attempts:ip:${ipAddress}`;
      await this.cache.del(ipKey);
    }
    await this.cache.del(userKey);

    // 重置数据库中的登录失败次数
    user.resetLoginAttempts();

    // 更新登录信息
    await this.updateLoginInfo(user.id, ipAddress || '');

    return user;
  }

  /**
   * 刷新令牌
   */
  async refreshToken(dto: RefreshTokenDto): Promise<AuthTokens> {
    const { refreshToken } = dto;

    try {
      // 验证刷新令牌
      const payload = await this.verifyRefreshToken(refreshToken);
      const tokenHash = hashRefreshToken(refreshToken);

      // 查找存储的刷新令牌
      const storedToken = await this.refreshTokenRepository.findOne({
        where: { tokenHash },
        relations: ['user', 'user.roles'],
      });

      if (!storedToken) {
        throw new UnauthorizedException('无效的刷新令牌');
      }

      if (!storedToken.isValid()) {
        throw new UnauthorizedException('无效的刷新令牌');
      }

      const user = storedToken.user;

      // 检查用户状态
      if (user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('用户账户状态异常');
      }

      let sessionId = storedToken.deviceId || payload.sessionId;
      if (!sessionId) {
        sessionId = StringUtil.shortUuid();
        storedToken.deviceId = sessionId;
        await this.refreshTokenRepository.save(storedToken);
      }

      // 生成新的访问令牌
      const accessToken = await this.generateAccessToken(user, sessionId);

      // 判断是否需要轮换刷新令牌
      // 如果刷新令牌快要过期（剩余时间少于7天），则生成新的刷新令牌
      const expiresIn = storedToken.expiresAt.getTime() - Date.now();
      const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;

      if (expiresIn < sevenDaysInMs) {
        // 撤销旧的刷新令牌
        storedToken.isRevoked = true;
        await this.refreshTokenRepository.save(storedToken);

        // 生成新的刷新令牌
        const newRefreshToken = await this.generateRefreshToken(user, sessionId);
        await this.saveRefreshToken(
          user.id,
          newRefreshToken,
          storedToken.ipAddress,
          storedToken.userAgent,
          sessionId,
        );

        this.logger.log(`Refresh token rotated for user ${user.username}`);

        return {
          accessToken,
          refreshToken: newRefreshToken,
          expiresIn: getExpiresInSeconds(this.accessTokenExpiresIn),
          sessionId,
        };
      }

      return {
        accessToken,
        refreshToken: refreshToken,
        expiresIn: getExpiresInSeconds(this.accessTokenExpiresIn),
        sessionId,
      };
    } catch (error) {
      this.logger.error(`[RefreshToken] Failed to refresh token: ${error.message}`, error.stack);
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('无效的刷新令牌');
    }
  }

  /**
   * 登出
   */
  async logout(userId: number, refreshToken?: string, currentSessionId?: string): Promise<void> {
    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      const storedToken = await this.refreshTokenRepository.findOne({
        where: { userId, tokenHash, isRevoked: false },
      });
      const sessionId = storedToken?.deviceId || currentSessionId;

      // 撤销指定的刷新令牌
      await this.refreshTokenRepository.update(
        { userId, tokenHash, isRevoked: false },
        { isRevoked: true },
      );

      if (sessionId) {
        await this.refreshTokenRepository.update(
          { userId, deviceId: sessionId, isRevoked: false },
          { isRevoked: true },
        );
      } else {
        await this.revokeAllAccessSessions(userId);
      }
    } else {
      // 撤销该用户的所有刷新令牌
      await this.refreshTokenRepository.update({ userId, isRevoked: false }, { isRevoked: true });
      await this.revokeAllAccessSessions(userId);
    }

    // 清除权限缓存
    await this.clearUserPermissionCache(userId);

    this.logger.log(`User ${userId} logged out`);
  }

  /**
   * 验证访问令牌
   */
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.accessTokenSecret,
      });

      if (payload.type !== 'access') {
        throw new UnauthorizedException('无效的访问令牌');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('无效的访问令牌');
    }
  }

  /**
   * 验证刷新令牌
   */
  async verifyRefreshToken(token: string): Promise<JwtPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.refreshTokenSecret,
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('无效的刷新令牌');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('无效的刷新令牌');
    }
  }

  /**
   * 生成令牌对
   */
  private async generateTokens(
    user: UserEntity,
    ipAddress?: string,
    userAgent?: string,
    sessionId?: string,
  ): Promise<AuthTokens> {
    const sid = sessionId ?? StringUtil.shortUuid();
    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(user, sid),
      this.generateRefreshToken(user, sid),
    ]);

    // 保存刷新令牌
    await this.saveRefreshToken(user.id, refreshToken, ipAddress, userAgent, sid);

    return {
      accessToken,
      refreshToken,
      expiresIn: getExpiresInSeconds(this.accessTokenExpiresIn),
      sessionId: sid,
    };
  }

  /**
   * 生成访问令牌
   */
  private async generateAccessToken(user: UserEntity, sessionId: string): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      type: 'access',
      sessionId,
      jti: StringUtil.shortUuid(), // 确保每个token唯一
      tokenVersion: user.tokenVersion ?? 0,
    };

    return this.jwtService.signAsync(payload as any, {
      secret: this.accessTokenSecret,
      expiresIn: this.accessTokenExpiresIn as any,
    });
  }

  /**
   * 生成刷新令牌
   */
  private async generateRefreshToken(user: UserEntity, sessionId: string): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      type: 'refresh',
      sessionId,
    };

    return this.jwtService.signAsync(payload as any, {
      secret: this.refreshTokenSecret,
      expiresIn: this.refreshTokenExpiresIn as any,
    });
  }

  /**
   * 保存刷新令牌
   */
  private async saveRefreshToken(
    userId: number,
    token: string,
    ipAddress?: string,
    userAgent?: string,
    deviceId?: string,
  ): Promise<void> {
    // 计算过期时间
    const expiresAt = new Date();
    const expiresInMs = getExpiresInSeconds(this.refreshTokenExpiresIn) * 1000;
    expiresAt.setTime(expiresAt.getTime() + expiresInMs);

    // 创建刷新令牌记录
    const refreshToken = this.refreshTokenRepository.create({
      tokenHash: hashRefreshToken(token),
      userId,
      ipAddress,
      userAgent,
      deviceId,
      expiresAt,
    });

    await this.refreshTokenRepository.save(refreshToken);

    // 限制每个用户最多保留5个有效的刷新令牌
    await this.limitUserRefreshTokens(userId, 5);
  }

  /**
   * 限制用户刷新令牌数量
   */
  private async limitUserRefreshTokens(userId: number, maxCount: number): Promise<void> {
    const tokens = await this.refreshTokenRepository.find({
      where: { userId, isRevoked: false },
      order: { id: 'DESC' }, // 使用 ID 而不是 createdAt 确保排序稳定性
    });

    if (tokens.length > maxCount) {
      const tokensToRevoke = tokens.slice(maxCount);

      // 批量撤销旧token
      for (const token of tokensToRevoke) {
        await this.refreshTokenRepository.update({ id: token.id }, { isRevoked: true });
      }
    }
  }

  /**
   * 清理过期的刷新令牌
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const result = await this.refreshTokenRepository.delete({
        expiresAt: LessThan(new Date()),
      });
      const count = result.affected || 0;

      if (count > 0) {
        this.logger.log(`Cleaned up ${count} expired refresh tokens`);
      }

      return count;
    } catch (error) {
      this.logger.error('Failed to cleanup expired tokens', error.stack);
      throw error;
    }
  }

  /**
   * 获取过期时间（秒）
   */
  private async clearUserPermissionCache(userId: number): Promise<void> {
    const cacheKey = `user:permissions:${userId}`;
    await this.cache.del(cacheKey);
  }

  private async recordIpLoginFailure(ipAddress?: string): Promise<void> {
    if (!ipAddress) {
      return;
    }

    await this.cache.incr(`login:attempts:ip:${ipAddress}`, 30 * 60);
  }

  private async createAuthResponse(
    user: UserEntity,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    const sessionId = StringUtil.shortUuid();
    const tokens = await this.generateTokens(user, ipAddress, userAgent, sessionId);

    this.logger.log(`User ${user.username} logged in from ${ipAddress}`);

    return {
      user: await this.toAuthUserResponse(user),
      tokens,
    };
  }

  private ensureUserCanLogin(
    user: UserEntity,
    account: string,
    ipAddress?: string,
    userAgent?: string,
  ): void {
    if (user.isLocked()) {
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
        this.emitLoginFailure(account, ipAddress, userAgent, '账户被锁定');
        throw new UnauthorizedException(`账户已被锁定，请${minutes}分钟后再试`);
      }
      this.emitLoginFailure(account, ipAddress, userAgent, '账户被锁定');
      throw new UnauthorizedException('账户已被锁定');
    }

    if (user.status === UserStatus.DISABLED) {
      this.emitLoginFailure(account, ipAddress, userAgent, '账户被禁用');
      throw new UnauthorizedException('账户已被禁用');
    }

    if (user.status === UserStatus.INACTIVE) {
      this.emitLoginFailure(account, ipAddress, userAgent, '账户未激活');
      throw new UnauthorizedException('账户未激活');
    }
  }

  private async resolveWeappOpenid(code: string): Promise<string> {
    const appId = this.configService.get<string>('weapp.appId');
    const appSecret = this.configService.get<string>('weapp.appSecret');

    if (!appId || !appSecret) {
      throw new UnauthorizedException('微信小程序登录未配置');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<WeappSessionResponse>(
          'https://api.weixin.qq.com/sns/jscode2session',
          {
            params: {
              appid: appId,
              secret: appSecret,
              js_code: code,
              grant_type: 'authorization_code',
            },
          },
        ),
      );
      const data = response.data;

      if (data.errcode || !data.openid) {
        throw new UnauthorizedException('微信登录凭证无效');
      }

      return data.openid;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('微信登录凭证无效');
    }
  }

  private async revokeAllAccessSessions(userId: number): Promise<void> {
    await this.userRepository.increment({ id: userId }, 'tokenVersion', 1);
  }

  private emitLoginFailure(account: string, ip?: string, userAgent?: string, reason?: string) {
    this.logger.warn(`Login failed for ${account}: ${reason || 'unknown reason'}`);
  }

  private async findUserForLogin(account: string): Promise<UserEntity | null> {
    let user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect(['user.password', 'user.weappOpenid', 'user.weappBoundAt'])
      .leftJoinAndSelect('user.roles', 'role')
      .leftJoinAndSelect('role.permissions', 'permission')
      .where('user.username = :account', { account })
      .getOne();

    if (!user) {
      user = await this.userRepository
        .createQueryBuilder('user')
        .addSelect(['user.password', 'user.weappOpenid', 'user.weappBoundAt'])
        .leftJoinAndSelect('user.roles', 'role')
        .leftJoinAndSelect('role.permissions', 'permission')
        .where('user.email = :account', { account })
        .getOne();
    }

    if (!user && /^\d{11}$/.test(account)) {
      user = await this.userRepository
        .createQueryBuilder('user')
        .addSelect(['user.password', 'user.weappOpenid', 'user.weappBoundAt'])
        .leftJoinAndSelect('user.roles', 'role')
        .leftJoinAndSelect('role.permissions', 'permission')
        .where('user.phone = :account', { account })
        .getOne();
    }

    return user;
  }

  private async toAuthUserResponse(user: UserEntity): Promise<AuthUserResponse> {
    const roles = (user.roles || []).map((role) => ({
      id: role.id,
      code: role.code,
      name: role.name,
    }));
    const roleCodes = roles.map((role) => role.code);
    const isSuperAdmin = roleCodes.includes('super_admin');

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      realName: user.realName,
      nickname: user.nickname,
      avatar: (await this.userService.resolveTrustedAvatarUrl(user.avatar)) ?? undefined,
      phone: user.phone,
      status: user.status,
      roles,
      permissions: isSuperAdmin ? ['*'] : this.collectActivePermissionCodes(user),
      isSuperAdmin,
      roleCode: isSuperAdmin ? 'super_admin' : roleCodes[0],
    };
  }

  private collectActivePermissionCodes(user: UserEntity): string[] {
    const codes = new Set<string>();

    for (const role of user.roles || []) {
      if (role.isActive === false) {
        continue;
      }

      for (const permission of role.permissions || []) {
        if (permission.isActive !== false) {
          codes.add(permission.code);
        }
      }
    }

    return Array.from(codes);
  }

  private async updateLoginInfo(
    userId: number,
    ip: string,
    loginTime: Date = new Date(),
  ): Promise<void> {
    await this.userRepository.update(userId, {
      lastLoginIp: ip,
      lastLoginAt: loginTime,
      loginAttempts: 0,
      lockedUntil: null,
    });
  }
}
