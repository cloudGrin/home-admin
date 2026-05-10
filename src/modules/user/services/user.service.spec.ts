import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UserEntity } from '../entities/user.entity';
import { RoleEntity } from '~/modules/role/entities/role.entity';
import { RefreshTokenEntity } from '~/modules/auth/entities/refresh-token.entity';
import { UserNotificationSettingEntity } from '~/modules/notification/entities/user-notification-setting.entity';
import { LoggerService } from '~/shared/logger/logger.service';
import { CacheService } from '~/shared/cache/cache.service';
import { FileService } from '~/modules/file/services/file.service';
import {
  UserMockFactory,
  RoleMockFactory,
  PermissionMockFactory,
  createMockRepository,
  createMockLogger,
  createMockCacheService,
} from '~/test-utils';
import { UserStatus } from '~/common/enums/user.enum';

const createUserQueryBuilderMock = () => {
  const builder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    withDeleted: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
    getManyAndCount: jest.fn(),
  };

  return builder;
};

describe('UserService', () => {
  let service: UserService;
  let userRepository: any;
  let roleRepository: jest.Mocked<any>;
  let refreshTokenRepository: jest.Mocked<any>;
  let notificationSettingRepository: jest.Mocked<any>;
  let fileService: jest.Mocked<Pick<FileService, 'createTrustedAccessLink'>>;
  let cache: jest.Mocked<CacheService>;
  let logger: jest.Mocked<LoggerService>;

  beforeEach(async () => {
    const mockUserRepository = createMockRepository<UserEntity>();
    const mockRoleRepository = createMockRepository<RoleEntity>();
    const mockRefreshTokenRepository = createMockRepository<RefreshTokenEntity>();
    const mockNotificationSettingRepository = createMockRepository<UserNotificationSettingEntity>();
    const mockFileService = {
      createTrustedAccessLink: jest.fn(),
    };
    const mockCache = createMockCacheService();
    const mockLogger = createMockLogger();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(RoleEntity),
          useValue: mockRoleRepository,
        },
        {
          provide: getRepositoryToken(RefreshTokenEntity),
          useValue: mockRefreshTokenRepository,
        },
        {
          provide: getRepositoryToken(UserNotificationSettingEntity),
          useValue: mockNotificationSettingRepository,
        },
        {
          provide: LoggerService,
          useValue: mockLogger,
        },
        {
          provide: CacheService,
          useValue: mockCache,
        },
        {
          provide: FileService,
          useValue: mockFileService,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get(getRepositoryToken(UserEntity));
    roleRepository = module.get(getRepositoryToken(RoleEntity));
    refreshTokenRepository = module.get(getRepositoryToken(RefreshTokenEntity));
    notificationSettingRepository = module.get(getRepositoryToken(UserNotificationSettingEntity));
    fileService = module.get(FileService) as jest.Mocked<
      Pick<FileService, 'createTrustedAccessLink'>
    >;
    cache = module.get(CacheService);
    logger = module.get(LoggerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    it('应该成功创建用户', async () => {
      const createDto = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'Password123!',
        nickname: '测试用户',
      };
      const mockUser = UserMockFactory.create({ ...createDto, id: 1 });
      const qb = createUserQueryBuilderMock();

      userRepository.createQueryBuilder.mockReturnValue(qb);
      qb.getCount.mockResolvedValue(0);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);

      const result = await service.createUser(createDto as any);

      const { password: _password, ...mockUserWithoutPassword } = mockUser;
      expect(result).toEqual(mockUserWithoutPassword);
      expect(userRepository.create).toHaveBeenCalledWith({
        ...createDto,
        roles: [],
      });
      expect(userRepository.save).toHaveBeenCalledWith(mockUser);
      expect(logger.log).toHaveBeenCalled();
    });

    it('用户名已存在时抛出ConflictException', async () => {
      const qb = createUserQueryBuilderMock();
      userRepository.createQueryBuilder.mockReturnValue(qb);
      qb.getCount.mockResolvedValue(1);

      await expect(
        service.createUser({
          username: 'existinguser',
          email: 'test@example.com',
          password: 'Password123!',
        } as any),
      ).rejects.toThrow(ConflictException);
      expect(qb.withDeleted).toHaveBeenCalled();
    });

    it('创建用户时忽略 roleIds，角色只能走专用分配接口', async () => {
      const qb = createUserQueryBuilderMock();
      const createDto = {
        username: 'roleuser',
        email: 'role@example.com',
        password: 'Password123!',
        roleIds: [1],
      };
      const mockUser = UserMockFactory.create({ id: 1, username: createDto.username });

      userRepository.createQueryBuilder.mockReturnValue(qb);
      qb.getCount.mockResolvedValue(0);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);

      await service.createUser(createDto as any);

      expect(roleRepository.find).not.toHaveBeenCalled();
      expect(userRepository.create).toHaveBeenCalledWith({
        username: createDto.username,
        email: createDto.email,
        password: createDto.password,
        roles: [],
      });
      expect(userRepository.create.mock.calls[0][0]).not.toHaveProperty('roleIds');
    });

    it('创建用户时不把 roleIds 写入用户实体', async () => {
      const createDto = {
        username: 'roleuser',
        email: 'role@example.com',
        password: 'Password123!',
        roleIds: [1],
      };
      const mockUser = UserMockFactory.create({ id: 1, username: createDto.username });
      const qb = createUserQueryBuilderMock();

      userRepository.createQueryBuilder.mockReturnValue(qb);
      qb.getCount.mockResolvedValue(0);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);

      await service.createUser(createDto as any);

      expect(userRepository.create).toHaveBeenCalledWith({
        username: createDto.username,
        email: createDto.email,
        password: createDto.password,
        roles: [],
      });
      expect(userRepository.create.mock.calls[0][0]).not.toHaveProperty('roleIds');
    });
  });

  describe('updateUser', () => {
    it('应该成功更新用户', async () => {
      const existingUser = UserMockFactory.create({ id: 1, email: 'old@example.com' });
      const qb = createUserQueryBuilderMock();

      userRepository.findOne.mockResolvedValue(existingUser);
      userRepository.createQueryBuilder.mockReturnValue(qb);
      qb.getCount.mockResolvedValue(0);
      userRepository.save.mockResolvedValue({ ...existingUser, email: 'new@example.com' });

      const result = await service.updateUser(1, { email: 'new@example.com' } as any);

      expect(result.email).toBe('new@example.com');
      expect(userRepository.save).toHaveBeenCalled();
    });

    it('邮箱重复时抛出ConflictException', async () => {
      const existingUser = UserMockFactory.create({ id: 1, email: 'old@example.com' });
      const qb = createUserQueryBuilderMock();

      userRepository.findOne.mockResolvedValue(existingUser);
      userRepository.createQueryBuilder.mockReturnValue(qb);
      qb.getCount.mockResolvedValue(1);

      await expect(service.updateUser(1, { email: 'new@example.com' } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(qb.withDeleted).toHaveBeenCalled();
    });

    it('更新用户时不把 roleIds 写入用户实体', async () => {
      const existingUser = UserMockFactory.create({ id: 1, email: 'old@example.com' });

      userRepository.findOne.mockResolvedValue(existingUser);
      userRepository.save.mockImplementation(async (entity) => entity);

      await service.updateUser(1, { nickname: '新昵称', roleIds: [2] } as any);

      const savedUser = userRepository.save.mock.calls[0][0];
      expect(roleRepository.find).not.toHaveBeenCalled();
      expect(savedUser).toMatchObject({ nickname: '新昵称' });
      expect(savedUser).not.toHaveProperty('roleIds');
    });

    it('通过通用更新接口禁用用户时撤销有效令牌', async () => {
      const existingUser = UserMockFactory.create({ id: 1, status: UserStatus.ACTIVE });

      userRepository.findOne.mockResolvedValue(existingUser);
      userRepository.save.mockImplementation(async (entity) => entity);
      refreshTokenRepository.update.mockResolvedValue(undefined);

      await service.updateUser(1, { status: UserStatus.DISABLED } as any);

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, isRevoked: false },
        { isRevoked: true },
      );
      expect(userRepository.increment).toHaveBeenCalledWith({ id: 1 }, 'tokenVersion', 1);
    });
  });

  describe('findUsers', () => {
    it('应该返回分页用户列表', async () => {
      const query = { page: 1, limit: 10, username: 'test' };
      const qb = createUserQueryBuilderMock();
      const mockUsers = UserMockFactory.createMany(2);

      userRepository.createQueryBuilder.mockReturnValue(qb);
      qb.getManyAndCount.mockResolvedValue([mockUsers, 2]);

      const result = await service.findUsers(query as any);

      expect(result.items).toEqual(mockUsers);
      expect(result.meta.totalItems).toBe(2);
    });

    it('按角色筛选时仍保留用户的完整角色列表', async () => {
      const qb = createUserQueryBuilderMock();

      userRepository.createQueryBuilder.mockReturnValue(qb);
      qb.getManyAndCount.mockResolvedValue([[UserMockFactory.create({ id: 1 })], 1]);

      await service.findUsers({ page: 1, limit: 10, roleId: 2 } as any);

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('user.roles', 'role');
      expect(qb.innerJoin).toHaveBeenCalledWith(
        'user.roles',
        'filterRole',
        'filterRole.id = :roleId',
        { roleId: 2 },
      );
      expect(qb.andWhere).not.toHaveBeenCalledWith('role.id = :roleId', { roleId: 2 });
    });

    it('ignores unsupported sort fields and falls back to createdAt ordering', async () => {
      const qb = createUserQueryBuilderMock();

      userRepository.createQueryBuilder.mockReturnValue(qb);
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findUsers({ page: 1, limit: 10, sort: 'id;DROP TABLE users' } as any);

      expect(qb.orderBy).toHaveBeenCalledWith('user.createdAt', 'DESC');
      expect(qb.orderBy).not.toHaveBeenCalledWith('user.id;DROP TABLE users', expect.anything());
    });
  });

  describe('findUserById', () => {
    it('应该返回用户详情', async () => {
      const user = UserMockFactory.create({ id: 1 });
      user.roles = [RoleMockFactory.create({ code: 'admin' })];
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.findUserById(1);

      expect(result).toEqual(user);
    });

    it('用户详情包含有效权限清单供前端按钮鉴权使用', async () => {
      const user = UserMockFactory.create({ id: 1 });
      const role = RoleMockFactory.create({ code: 'task_user', isActive: true });
      role.permissions = [
        PermissionMockFactory.create({ code: 'task:read', isActive: true }),
        PermissionMockFactory.create({ code: 'task:update', isActive: true }),
        PermissionMockFactory.create({ code: 'task:delete', isActive: false }),
      ];
      user.roles = [role];
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.findUserById(1);

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['roles', 'roles.permissions'],
      });
      expect((result as any).permissions).toEqual(['task:read', 'task:update']);
    });

    it('用户不存在时抛出NotFoundException', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.findUserById(1)).rejects.toThrow(NotFoundException);
    });

    it('为当前用户资料中的本地头像生成30天私有缓存链接', async () => {
      const user = UserMockFactory.create({ id: 1, avatar: '/api/v1/files/9/public' });
      userRepository.findOne.mockResolvedValue(user);
      fileService.createTrustedAccessLink.mockResolvedValue({
        url: '/api/v1/files/9/access?token=avatar',
        token: 'avatar',
        expiresAt: '2026-06-01T00:00:00.000Z',
      });

      const result = await service.findUserProfileById(1);

      expect(fileService.createTrustedAccessLink).toHaveBeenCalledWith(9, {
        disposition: 'inline',
        cacheMaxAgeSeconds: 30 * 24 * 60 * 60,
      });
      expect(result.avatar).toBe('/api/v1/files/9/access?token=avatar');
    });
  });

  describe('changePassword', () => {
    it('应该成功修改密码并撤销refresh token表中的有效令牌', async () => {
      const user = UserMockFactory.create({ id: 1 });
      user.validatePassword = jest.fn().mockResolvedValue(true);
      userRepository.findOne.mockResolvedValue(user);
      userRepository.save.mockResolvedValue(user);
      refreshTokenRepository.update.mockResolvedValue(undefined);

      await service.changePassword(1, {
        oldPassword: 'old',
        newPassword: 'new',
        confirmPassword: 'new',
      });

      expect(userRepository.save).toHaveBeenCalledWith(user);
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, isRevoked: false },
        { isRevoked: true },
      );
      expect(userRepository.increment).toHaveBeenCalledWith({ id: 1 }, 'tokenVersion', 1);
    });

    it('旧密码错误时抛出BadRequestException', async () => {
      const user = UserMockFactory.create({ id: 1 });
      user.validatePassword = jest.fn().mockResolvedValue(false);
      userRepository.findOne.mockResolvedValue(user);

      await expect(
        service.changePassword(1, {
          oldPassword: 'old',
          newPassword: 'new',
          confirmPassword: 'new',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resetPassword', () => {
    it('应该成功重置密码', async () => {
      const user = UserMockFactory.create({ id: 1 });
      userRepository.findOne.mockResolvedValue(user);
      userRepository.save.mockResolvedValue(user);
      refreshTokenRepository.update.mockResolvedValue(undefined);

      await service.resetPassword(1, { password: 'Password123!' });

      expect(user.lockedUntil).toBeNull();
      expect(userRepository.save).toHaveBeenCalledWith(user);
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, isRevoked: false },
        { isRevoked: true },
      );
      expect(userRepository.increment).toHaveBeenCalledWith({ id: 1 }, 'tokenVersion', 1);
    });
  });

  describe('enable/disableUser', () => {
    it('应该启用用户', async () => {
      const user = UserMockFactory.create({ id: 1, status: UserStatus.DISABLED });
      userRepository.findOne.mockResolvedValue(user);
      userRepository.save.mockResolvedValue({ ...user, status: UserStatus.ACTIVE });

      const result = await service.enableUser(1);

      expect(result.status).toBe(UserStatus.ACTIVE);
      expect(userRepository.save.mock.calls[0][0].lockedUntil).toBeNull();
    });

    it('应该禁用用户并撤销refresh token表中的有效令牌', async () => {
      const user = UserMockFactory.create({ id: 1, status: UserStatus.ACTIVE });
      userRepository.findOne.mockResolvedValue(user);
      userRepository.save.mockResolvedValue({ ...user, status: UserStatus.DISABLED });
      refreshTokenRepository.update.mockResolvedValue(undefined);

      const result = await service.disableUser(1);

      expect(result.status).toBe(UserStatus.DISABLED);
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, isRevoked: false },
        { isRevoked: true },
      );
      expect(userRepository.increment).toHaveBeenCalledWith({ id: 1 }, 'tokenVersion', 1);
    });
  });

  describe('deleteUser/deleteUsers', () => {
    it('应该删除单个用户', async () => {
      const user = UserMockFactory.create({ id: 1 });
      userRepository.findOne.mockResolvedValue(user);
      userRepository.softDelete.mockResolvedValue({ affected: 1 });

      await service.deleteUser(1);

      expect(userRepository.softDelete).toHaveBeenCalledWith(1);
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, isRevoked: false },
        { isRevoked: true },
      );
      expect(userRepository.increment).toHaveBeenCalledWith({ id: 1 }, 'tokenVersion', 1);
    });

    it('批量删除时用户不全应抛出异常', async () => {
      userRepository.find.mockResolvedValue([UserMockFactory.create({ id: 1 })]);

      await expect(service.deleteUsers([1, 2])).rejects.toThrow(BadRequestException);
    });

    it('批量删除用户时撤销每个用户的refresh token', async () => {
      userRepository.find.mockResolvedValue([
        UserMockFactory.create({ id: 1 }),
        UserMockFactory.create({ id: 2 }),
      ]);
      userRepository.softDelete.mockResolvedValue({ affected: 1 });
      refreshTokenRepository.update.mockResolvedValue(undefined);

      await service.deleteUsers([1, 2]);

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, isRevoked: false },
        { isRevoked: true },
      );
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 2, isRevoked: false },
        { isRevoked: true },
      );
      expect(userRepository.increment).toHaveBeenCalledWith({ id: 1 }, 'tokenVersion', 1);
      expect(userRepository.increment).toHaveBeenCalledWith({ id: 2 }, 'tokenVersion', 1);
    });
  });

  describe('notification settings', () => {
    it('returns disabled channel defaults when a user has no notification binding', async () => {
      userRepository.findOne.mockResolvedValue(UserMockFactory.create({ id: 1 }));
      notificationSettingRepository.findOne.mockResolvedValue(null);

      await expect(service.getNotificationSettings(1)).resolves.toMatchObject({
        userId: 1,
        barkKey: null,
        feishuUserId: null,
      });
    });

    it('saves admin maintained notification binding targets', async () => {
      userRepository.findOne.mockResolvedValue(UserMockFactory.create({ id: 1 }));
      notificationSettingRepository.findOne.mockResolvedValue(null);
      notificationSettingRepository.create.mockImplementation((value: any) => value);
      notificationSettingRepository.save.mockImplementation(async (value: any) => ({
        id: 10,
        ...value,
      }));

      await expect(
        service.updateNotificationSettings(1, {
          barkKey: 'user-bark-key',
          feishuUserId: 'ou_user_1',
        }),
      ).resolves.toMatchObject({
        userId: 1,
        barkKey: 'user-bark-key',
        feishuUserId: 'ou_user_1',
      });

      expect(notificationSettingRepository.create).toHaveBeenCalledWith({
        userId: 1,
        barkKey: 'user-bark-key',
        feishuUserId: 'ou_user_1',
      });
    });

    it('normalizes blank channel targets to null', async () => {
      userRepository.findOne.mockResolvedValue(UserMockFactory.create({ id: 1 }));
      notificationSettingRepository.findOne.mockResolvedValue(null);
      notificationSettingRepository.create.mockImplementation((value: any) => value);
      notificationSettingRepository.save.mockImplementation(async (value: any) => value);

      await expect(
        service.updateNotificationSettings(1, {
          barkKey: '',
          feishuUserId: '   ',
        }),
      ).resolves.toMatchObject({
        barkKey: null,
        feishuUserId: null,
      });
    });

    it('clears channel target values when settings send null', async () => {
      userRepository.findOne.mockResolvedValue(UserMockFactory.create({ id: 1 }));
      notificationSettingRepository.findOne.mockResolvedValue({
        id: 10,
        userId: 1,
        barkKey: 'old-bark-key',
        feishuUserId: 'ou_old',
      });
      notificationSettingRepository.save.mockImplementation(async (value: any) => value);

      await expect(
        service.updateNotificationSettings(1, {
          barkKey: null,
          feishuUserId: null,
        }),
      ).resolves.toMatchObject({
        barkKey: null,
        feishuUserId: null,
      });
    });

    it('rejects non-super-admin actors updating super admin notification bindings', async () => {
      const superAdminUser = UserMockFactory.create({ id: 1 });
      superAdminUser.roles = [RoleMockFactory.create({ code: 'super_admin' })];
      userRepository.findOne.mockResolvedValue(superAdminUser);

      await expect(
        (service as any).updateNotificationSettings(
          1,
          {
            barkKey: 'user-bark-key',
          },
          { id: 2, isSuperAdmin: false, roleCode: 'admin' },
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(notificationSettingRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('assignRoles', () => {
    it('应该成功分配角色', async () => {
      const user = UserMockFactory.create({ id: 1 });
      const roles = RoleMockFactory.createMany(2, { isActive: true });
      userRepository.findOne.mockResolvedValue(user);
      roleRepository.find.mockResolvedValue(roles);
      userRepository.save.mockResolvedValue({ ...user, roles });

      const result = await service.assignRoles(
        1,
        roles.map((role) => role.id),
      );

      expect(result.roles).toEqual(roles);
      expect(userRepository.save).toHaveBeenCalled();
    });

    it('允许传空角色列表来清空用户角色', async () => {
      const user = UserMockFactory.create({ id: 1 });
      user.roles = [RoleMockFactory.create({ id: 1 })];
      userRepository.findOne.mockResolvedValue(user);
      userRepository.save.mockImplementation(async (entity) => entity);

      const result = await service.assignRoles(1, []);

      expect(roleRepository.find).not.toHaveBeenCalled();
      expect(result.roles).toEqual([]);
      expect(cache.del).toHaveBeenCalledWith('user:permissions:1');
    });
  });

  describe('getUserPermissions', () => {
    it('应该计算并缓存用户权限', async () => {
      const user = UserMockFactory.create({ id: 1 });
      const role = RoleMockFactory.create({ isActive: true });
      role.permissions = [
        { code: 'user:read', isActive: true },
        { code: 'user:write', isActive: true },
      ] as any;
      user.roles = [role];
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.getUserPermissions(1);

      expect(result).toEqual(['user:read', 'user:write']);
      expect(cache.set).toHaveBeenCalled();
    });

    it('缓存命中时直接返回缓存', async () => {
      cache.get.mockResolvedValue(['user:read']);

      const result = await service.getUserPermissions(1);

      expect(result).toEqual(['user:read']);
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('findByUsername/findByEmail', () => {
    it('应该根据用户名查询用户', async () => {
      const user = UserMockFactory.create({ username: 'testuser' });
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.findByUsername('testuser');

      expect(result).toEqual(user);
    });

    it('应该根据邮箱查询用户', async () => {
      const user = UserMockFactory.create({ email: 'test@example.com' });
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.findByEmail('test@example.com');

      expect(result).toEqual(user);
    });
  });
});
