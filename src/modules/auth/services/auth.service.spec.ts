import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of } from 'rxjs';
import { AuthService } from './auth.service';
import { LoggerService } from '~/shared/logger/logger.service';
import { CacheService } from '~/shared/cache/cache.service';
import { UserEntity } from '~/modules/user/entities/user.entity';
import { UserService } from '~/modules/user/services/user.service';
import { RefreshTokenEntity } from '../entities/refresh-token.entity';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { UserStatus } from '~/common/enums/user.enum';
import { faker } from '@faker-js/faker';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { RoleEntity } from '~/modules/role/entities/role.entity';
import { PermissionEntity } from '~/modules/permission/entities/permission.entity';

const createUserLoginQueryBuilder = () => {
  const qb = {
    addSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  return qb;
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: any;
  let refreshTokenRepository: any;
  let jwtService: jest.Mocked<JwtService>;
  let httpService: jest.Mocked<HttpService>;
  let logger: jest.Mocked<LoggerService>;
  let cacheService: jest.Mocked<CacheService>;

  const createMockUser = (overrides?: Partial<UserEntity>): UserEntity => {
    const user = new UserEntity();
    user.id = faker.number.int({ min: 1, max: 1000 });
    user.username = faker.internet.userName();
    user.email = faker.internet.email();
    user.password = bcrypt.hashSync('Password123!', 10);
    user.realName = faker.person.fullName();
    user.status = UserStatus.ACTIVE;
    user.tokenVersion = 0;
    user.lockedUntil = null;
    user.loginAttempts = 0;
    user.roles = [];
    user.createdAt = new Date();
    user.updatedAt = new Date();
    user.isLocked = jest.fn().mockReturnValue(false);
    user.validatePassword = jest.fn().mockResolvedValue(true);
    user.incrementLoginAttempts = jest.fn();
    user.resetLoginAttempts = jest.fn();
    return Object.assign(user, overrides);
  };

  const createMockRefreshToken = (overrides?: Partial<RefreshTokenEntity>): RefreshTokenEntity => {
    const token = new RefreshTokenEntity();
    token.id = faker.number.int({ min: 1, max: 1000 });
    token.userId = faker.number.int({ min: 1, max: 1000 });
    token.tokenHash = hashToken(faker.string.uuid());
    token.deviceId = faker.string.uuid();
    token.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    token.isRevoked = false;
    token.ipAddress = '192.168.1.1';
    token.userAgent = 'Mozilla/5.0';
    token.createdAt = new Date();
    token.isValid = jest.fn().mockReturnValue(true);
    return Object.assign(token, overrides);
  };

  beforeEach(async () => {
    const mockUserRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      increment: jest.fn(),
    };

    const mockRefreshTokenRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
    };

    const mockJwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config = {
          'jwt.secret': 'test-secret',
          'jwt.expiresIn': '15m',
          'jwt.refreshSecret': 'test-refresh-secret',
          'jwt.refreshExpiresIn': '30d',
          'weapp.appId': 'wx-test-app',
          'weapp.appSecret': 'wx-test-secret',
        };
        return config[key];
      }),
    };

    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      incr: jest.fn(),
    };

    const mockUserService = {
      resolveTrustedAvatarUrl: jest.fn(async (avatar?: string | null) => avatar),
    };

    const mockHttpService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(UserEntity), useValue: mockUserRepository },
        { provide: getRepositoryToken(RefreshTokenEntity), useValue: mockRefreshTokenRepository },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLogger },
        { provide: CacheService, useValue: mockCacheService },
        { provide: UserService, useValue: mockUserService },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get(getRepositoryToken(UserEntity));
    refreshTokenRepository = module.get(getRepositoryToken(RefreshTokenEntity));
    jwtService = module.get(JwtService);
    httpService = module.get(HttpService);
    logger = module.get(LoggerService);
    cacheService = module.get(CacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('cleanupExpiredTokens', () => {
    it('returns the number of deleted expired refresh tokens', async () => {
      refreshTokenRepository.delete.mockResolvedValue({ affected: 3 });

      await expect(service.cleanupExpiredTokens()).resolves.toBe(3);

      expect(refreshTokenRepository.delete).toHaveBeenCalledWith({
        expiresAt: expect.any(Object),
      });
      expect(logger.log).toHaveBeenCalledWith('Cleaned up 3 expired refresh tokens');
    });

    it('rethrows cleanup errors so automation can record a failed run', async () => {
      const error = new Error('database unavailable');
      refreshTokenRepository.delete.mockRejectedValue(error);

      await expect(service.cleanupExpiredTokens()).rejects.toThrow('database unavailable');
      expect(logger.error).toHaveBeenCalledWith('Failed to cleanup expired tokens', error.stack);
    });
  });

  describe('login', () => {
    const mockLoginDto: LoginDto = {
      account: 'testuser',
      password: 'Password123!',
    };
    const mockIp = '192.168.1.100';
    const mockUserAgent = 'Mozilla/5.0';

    it('应该成功登录并返回用户信息和令牌', async () => {
      const mockUser = createMockUser({ username: 'testuser', status: UserStatus.ACTIVE });
      const qb = createUserLoginQueryBuilder();
      qb.getOne.mockResolvedValue(mockUser);
      const refreshTokenEntity = createMockRefreshToken();

      userRepository.createQueryBuilder.mockReturnValue(qb);
      userRepository.update.mockResolvedValue(undefined);
      jwtService.signAsync
        .mockResolvedValueOnce('mock-access-token')
        .mockResolvedValueOnce('mock-refresh-token');
      refreshTokenRepository.create.mockReturnValue(refreshTokenEntity);
      refreshTokenRepository.save.mockResolvedValue(refreshTokenEntity);

      const result = await service.login(mockLoginDto, mockIp, mockUserAgent);

      expect(result.tokens.accessToken).toBe('mock-access-token');
      expect(result.tokens.refreshToken).toBe('mock-refresh-token');
      expect(result.user).toMatchObject({
        id: mockUser.id,
        username: mockUser.username,
        email: mockUser.email,
        roles: [],
        isSuperAdmin: false,
      });
      expect(result.user).not.toHaveProperty('password');
      expect(result.user).not.toHaveProperty('loginAttempts');
      expect(mockUser.validatePassword).toHaveBeenCalledWith(mockLoginDto.password);
      expect(userRepository.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ lastLoginIp: mockIp }),
      );
      expect(refreshTokenRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenHash: hashToken('mock-refresh-token'),
          userId: mockUser.id,
        }),
      );
      expect(refreshTokenRepository.create.mock.calls[0][0]).not.toHaveProperty('token');
      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          type: 'access',
          tokenVersion: mockUser.tokenVersion,
        }),
        expect.any(Object),
      );
    });

    it('登录响应包含普通角色的有效权限清单', async () => {
      const role = Object.assign(new RoleEntity(), {
        id: 2,
        code: 'task_user',
        name: '任务用户',
        isActive: true,
        permissions: [
          Object.assign(new PermissionEntity(), { code: 'task:read', isActive: true }),
          Object.assign(new PermissionEntity(), { code: 'task:create', isActive: true }),
          Object.assign(new PermissionEntity(), { code: 'task:delete', isActive: false }),
        ],
      });
      const mockUser = createMockUser({
        username: 'testuser',
        status: UserStatus.ACTIVE,
        roles: [role],
      });
      const qb = createUserLoginQueryBuilder();
      qb.getOne.mockResolvedValue(mockUser);
      const refreshTokenEntity = createMockRefreshToken();

      userRepository.createQueryBuilder.mockReturnValue(qb);
      userRepository.update.mockResolvedValue(undefined);
      jwtService.signAsync
        .mockResolvedValueOnce('mock-access-token')
        .mockResolvedValueOnce('mock-refresh-token');
      refreshTokenRepository.create.mockReturnValue(refreshTokenEntity);
      refreshTokenRepository.save.mockResolvedValue(refreshTokenEntity);

      const result = await service.login(mockLoginDto, mockIp, mockUserAgent);

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('role.permissions', 'permission');
      expect(result.user.permissions).toEqual(['task:read', 'task:create']);
    });

    it('登录响应为超级管理员返回通配符权限', async () => {
      const role = Object.assign(new RoleEntity(), {
        id: 1,
        code: 'super_admin',
        name: '超级管理员',
        isActive: true,
        permissions: [],
      });
      const mockUser = createMockUser({
        username: 'root',
        status: UserStatus.ACTIVE,
        roles: [role],
      });
      const qb = createUserLoginQueryBuilder();
      qb.getOne.mockResolvedValue(mockUser);
      const refreshTokenEntity = createMockRefreshToken();

      userRepository.createQueryBuilder.mockReturnValue(qb);
      userRepository.update.mockResolvedValue(undefined);
      jwtService.signAsync
        .mockResolvedValueOnce('mock-access-token')
        .mockResolvedValueOnce('mock-refresh-token');
      refreshTokenRepository.create.mockReturnValue(refreshTokenEntity);
      refreshTokenRepository.save.mockResolvedValue(refreshTokenEntity);

      const result = await service.login(mockLoginDto, mockIp, mockUserAgent);

      expect(result.user.isSuperAdmin).toBe(true);
      expect(result.user.roleCode).toBe('super_admin');
      expect(result.user.permissions).toEqual(['*']);
    });

    it('当用户不存在时应该抛出UnauthorizedException', async () => {
      const qb = createUserLoginQueryBuilder();
      qb.getOne.mockResolvedValue(null);
      userRepository.createQueryBuilder.mockReturnValue(qb);

      await expect(service.login(mockLoginDto, mockIp, mockUserAgent)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(cacheService.incr).toHaveBeenCalledWith(`login:attempts:ip:${mockIp}`, 30 * 60);
    });

    it('当密码错误时应该抛出UnauthorizedException并记录失败', async () => {
      const mockUser = createMockUser();
      (mockUser.validatePassword as jest.Mock).mockResolvedValue(false);
      const qb = createUserLoginQueryBuilder();
      qb.getOne.mockResolvedValue(mockUser);
      userRepository.createQueryBuilder.mockReturnValue(qb);
      userRepository.save.mockResolvedValue(mockUser);

      await expect(service.login(mockLoginDto, mockIp, mockUserAgent)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockUser.incrementLoginAttempts).toHaveBeenCalled();
      expect(userRepository.save).toHaveBeenCalledWith(mockUser);
      expect(cacheService.incr).toHaveBeenCalled();
    });

    it('uses seconds for login lockout cache TTLs', async () => {
      const mockUser = createMockUser({ roles: [{ code: 'user' }] as any });
      (mockUser.validatePassword as jest.Mock).mockResolvedValue(false);
      const qb = createUserLoginQueryBuilder();
      qb.getOne.mockResolvedValue(mockUser);
      userRepository.createQueryBuilder.mockReturnValue(qb);
      userRepository.save.mockResolvedValue(mockUser);

      await expect(service.login(mockLoginDto, mockIp, mockUserAgent)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(cacheService.incr).toHaveBeenCalledWith(`login:attempts:ip:${mockIp}`, 30 * 60);
      expect(cacheService.incr).toHaveBeenCalledWith(
        `login:attempts:user:${mockLoginDto.account}`,
        30 * 60,
      );
    });

    it('当账户被禁用时应该抛出UnauthorizedException', async () => {
      const mockUser = createMockUser({ status: UserStatus.DISABLED });
      const qb = createUserLoginQueryBuilder();
      qb.getOne.mockResolvedValue(mockUser);
      userRepository.createQueryBuilder.mockReturnValue(qb);

      await expect(service.login(mockLoginDto, mockIp, mockUserAgent)).rejects.toThrow(
        '账户已被禁用',
      );
    });
  });

  describe('weapp login and bind', () => {
    const mockIp = '192.168.1.100';
    const mockUserAgent = 'MicroMessenger';

    beforeEach(() => {
      httpService.get.mockReturnValue(of({ data: { openid: 'openid-1' } }) as any);
    });

    it('logs in an already-bound WeChat mini-program user', async () => {
      const mockUser = createMockUser({
        username: 'family-user',
        status: UserStatus.ACTIVE,
        weappOpenid: 'openid-1',
      } as Partial<UserEntity>);
      const refreshTokenEntity = createMockRefreshToken();

      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.update.mockResolvedValue(undefined);
      jwtService.signAsync
        .mockResolvedValueOnce('mock-access-token')
        .mockResolvedValueOnce('mock-refresh-token');
      refreshTokenRepository.create.mockReturnValue(refreshTokenEntity);
      refreshTokenRepository.save.mockResolvedValue(refreshTokenEntity);

      const result = await service.loginWithWeappCode({ code: 'wx-code' }, mockIp, mockUserAgent);

      expect(result.tokens.accessToken).toBe('mock-access-token');
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { weappOpenid: 'openid-1' },
        relations: ['roles', 'roles.permissions'],
      });
    });

    it('rejects silent login when the WeChat openid is not bound', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.loginWithWeappCode({ code: 'wx-code' }, mockIp, mockUserAgent),
      ).rejects.toThrow('微信账号未绑定');
    });

    it('rejects silent login when the bound account is locked', async () => {
      const mockUser = createMockUser({
        username: 'family-user',
        status: UserStatus.ACTIVE,
        weappOpenid: 'openid-1',
        lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
      } as Partial<UserEntity>);
      (mockUser.isLocked as jest.Mock).mockReturnValue(true);
      userRepository.findOne.mockResolvedValue(mockUser);

      await expect(
        service.loginWithWeappCode({ code: 'wx-code' }, mockIp, mockUserAgent),
      ).rejects.toThrow('账户已被锁定');

      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(refreshTokenRepository.create).not.toHaveBeenCalled();
    });

    it('binds an existing account to the WeChat openid and returns tokens', async () => {
      const mockUser = createMockUser({
        username: 'family-user',
        status: UserStatus.ACTIVE,
        weappOpenid: null,
      } as Partial<UserEntity>);
      const qb = createUserLoginQueryBuilder();
      qb.getOne.mockResolvedValue(mockUser);
      const refreshTokenEntity = createMockRefreshToken();

      userRepository.findOne.mockResolvedValue(null);
      userRepository.createQueryBuilder.mockReturnValue(qb);
      userRepository.update.mockResolvedValue(undefined);
      jwtService.signAsync
        .mockResolvedValueOnce('mock-access-token')
        .mockResolvedValueOnce('mock-refresh-token');
      refreshTokenRepository.create.mockReturnValue(refreshTokenEntity);
      refreshTokenRepository.save.mockResolvedValue(refreshTokenEntity);

      const result = await service.bindWeappAccount(
        { code: 'wx-code', account: 'family-user', password: 'Password123!' },
        mockIp,
        mockUserAgent,
      );

      expect(result.tokens.refreshToken).toBe('mock-refresh-token');
      expect(userRepository.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ lastLoginIp: mockIp }),
      );
      expect(userRepository.update).toHaveBeenCalledWith(
        { id: mockUser.id },
        {
          weappOpenid: 'openid-1',
          weappBoundAt: expect.any(Date),
        },
      );
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('rejects binding when the WeChat openid belongs to another account', async () => {
      userRepository.findOne.mockResolvedValue(createMockUser({ id: 99 } as Partial<UserEntity>));

      await expect(
        service.bindWeappAccount(
          { code: 'wx-code', account: 'family-user', password: 'Password123!' },
          mockIp,
          mockUserAgent,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects binding when the account already has another WeChat openid', async () => {
      const mockUser = createMockUser({
        username: 'family-user',
        status: UserStatus.ACTIVE,
        weappOpenid: 'openid-other',
      } as Partial<UserEntity>);
      const qb = createUserLoginQueryBuilder();
      qb.getOne.mockResolvedValue(mockUser);

      userRepository.findOne.mockResolvedValue(null);
      userRepository.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.bindWeappAccount(
          { code: 'wx-code', account: 'family-user', password: 'Password123!' },
          mockIp,
          mockUserAgent,
        ),
      ).rejects.toThrow('该账号已绑定其他微信账号');
    });
  });

  describe('refreshToken', () => {
    const mockRefreshTokenString = 'mock-refresh-token';
    const mockRefreshTokenDto: RefreshTokenDto = {
      refreshToken: mockRefreshTokenString,
    };

    it('应该成功刷新令牌并返回新的访问令牌', async () => {
      const mockUser = createMockUser({ status: UserStatus.ACTIVE });
      const mockRefreshToken = createMockRefreshToken({
        userId: mockUser.id,
        tokenHash: hashToken(mockRefreshTokenString),
        expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        user: mockUser,
      });

      jwtService.verifyAsync.mockResolvedValue({
        sub: mockUser.id,
        username: mockUser.username,
        type: 'refresh',
        sessionId: mockRefreshToken.deviceId,
      } as any);
      refreshTokenRepository.findOne.mockResolvedValue(mockRefreshToken);
      jwtService.signAsync.mockResolvedValue('new-access-token');

      const result = await service.refreshToken(mockRefreshTokenDto);

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe(mockRefreshTokenString);
      expect(refreshTokenRepository.findOne).toHaveBeenCalledWith({
        where: { tokenHash: hashToken(mockRefreshTokenString) },
        relations: ['user', 'user.roles'],
      });
    });

    it('当刷新令牌即将过期时应该旋转令牌', async () => {
      const mockUser = createMockUser({ status: UserStatus.ACTIVE });
      const storedToken = createMockRefreshToken({
        userId: mockUser.id,
        tokenHash: hashToken(mockRefreshTokenString),
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        user: mockUser,
      });
      const newRefreshEntity = createMockRefreshToken();

      jwtService.verifyAsync.mockResolvedValue({
        sub: mockUser.id,
        username: mockUser.username,
        type: 'refresh',
        sessionId: storedToken.deviceId,
      } as any);
      refreshTokenRepository.findOne.mockResolvedValue(storedToken);
      jwtService.signAsync
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token');
      refreshTokenRepository.save.mockResolvedValue(storedToken);
      refreshTokenRepository.create.mockReturnValue(newRefreshEntity);

      const result = await service.refreshToken(mockRefreshTokenDto);

      expect(result.refreshToken).toBe('new-refresh-token');
      expect(refreshTokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isRevoked: true }),
      );
    });

    it('当刷新令牌无效时应该抛出UnauthorizedException', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('Invalid token'));

      await expect(service.refreshToken(mockRefreshTokenDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('应该成功登出单个会话', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(
        createMockRefreshToken({
          userId: 1,
          tokenHash: hashToken('refresh-token'),
          deviceId: 'session-1',
        }),
      );
      refreshTokenRepository.update.mockResolvedValue(undefined);

      await service.logout(1, 'refresh-token');

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, tokenHash: hashToken('refresh-token'), isRevoked: false },
        { isRevoked: true },
      );
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, deviceId: 'session-1', isRevoked: false },
        { isRevoked: true },
      );
      expect(cacheService.del).toHaveBeenCalledWith('user:permissions:1');
    });

    it('传入无效刷新令牌时仍撤销当前访问令牌对应会话', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(null);
      refreshTokenRepository.update.mockResolvedValue(undefined);

      await service.logout(1, 'stale-refresh-token', 'current-session');

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, tokenHash: hashToken('stale-refresh-token'), isRevoked: false },
        { isRevoked: true },
      );
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, deviceId: 'current-session', isRevoked: false },
        { isRevoked: true },
      );
    });

    it('应该成功登出所有会话', async () => {
      refreshTokenRepository.update.mockResolvedValue(undefined);

      await service.logout(1);

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, isRevoked: false },
        { isRevoked: true },
      );
      expect(userRepository.increment).toHaveBeenCalledWith({ id: 1 }, 'tokenVersion', 1);
      expect(cacheService.del).toHaveBeenCalledWith('user:permissions:1');
    });

    it('撤销刷新令牌失败时应该向调用方抛出异常', async () => {
      refreshTokenRepository.update.mockRejectedValue(new Error('database unavailable'));

      await expect(service.logout(1, 'refresh-token')).rejects.toThrow('database unavailable');
    });
  });

  describe('limitUserRefreshTokens', () => {
    it('keeps the newly-created token within the max session count', async () => {
      const tokens = [6, 5, 4, 3, 2, 1].map((id) =>
        createMockRefreshToken({
          id,
          userId: 1,
          tokenHash: hashToken(`token-${id}`),
        }),
      );
      refreshTokenRepository.find.mockResolvedValue(tokens);
      refreshTokenRepository.update.mockResolvedValue(undefined);

      await (service as any).limitUserRefreshTokens(1, 5, 6);

      expect(refreshTokenRepository.update).toHaveBeenCalledTimes(1);
      expect(refreshTokenRepository.update).toHaveBeenCalledWith({ id: 1 }, { isRevoked: true });
    });
  });
});
