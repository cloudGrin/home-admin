import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { UserStatus } from '~/common/enums/user.enum';
import { LoggerService } from '~/shared/logger/logger.service';
import { createMockLogger, createMockRepository } from '~/test-utils';
import { RoleCategory, RoleEntity } from '~/modules/role/entities/role.entity';
import { MenuEntity } from '~/modules/menu/entities/menu.entity';
import { PermissionEntity } from '~/modules/permission/entities/permission.entity';
import { UserEntity } from '../entities/user.entity';
import { AdminBootstrapService } from './admin-bootstrap.service';

describe('AdminBootstrapService', () => {
  let service: AdminBootstrapService;
  let userRepository: jest.Mocked<Repository<UserEntity>>;
  let roleRepository: jest.Mocked<Repository<RoleEntity>>;
  let menuRepository: jest.Mocked<Repository<MenuEntity>>;
  let permissionRepository: jest.Mocked<Repository<PermissionEntity>>;
  let logger: jest.Mocked<LoggerService>;

  beforeEach(async () => {
    const userRepositoryMock = {
      ...createMockRepository<UserEntity>(),
      count: jest.fn(),
    };
    const menuRepositoryMock = {
      ...createMockRepository<MenuEntity>(),
      count: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBootstrapService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: userRepositoryMock,
        },
        {
          provide: getRepositoryToken(RoleEntity),
          useValue: createMockRepository<RoleEntity>(),
        },
        {
          provide: getRepositoryToken(MenuEntity),
          useValue: menuRepositoryMock,
        },
        {
          provide: getRepositoryToken(PermissionEntity),
          useValue: createMockRepository<PermissionEntity>(),
        },
        {
          provide: LoggerService,
          useValue: createMockLogger(),
        },
      ],
    }).compile();

    service = module.get(AdminBootstrapService);
    userRepository = module.get(getRepositoryToken(UserEntity));
    roleRepository = module.get(getRepositoryToken(RoleEntity));
    menuRepository = module.get(getRepositoryToken(MenuEntity));
    permissionRepository = module.get(getRepositoryToken(PermissionEntity));
    logger = module.get(LoggerService);
  });

  it('空库启动时创建 admin 超级管理员并生成正确的默认菜单树', async () => {
    const role = Object.assign(new RoleEntity(), {
      id: 1,
      code: 'super_admin',
      name: '超级管理员',
      category: RoleCategory.SYSTEM,
      isActive: true,
      isSystem: true,
    });
    const user = Object.assign(new UserEntity(), {
      id: 1,
      username: 'admin',
      email: 'admin@local.home',
      status: UserStatus.ACTIVE,
      roles: [role],
    });

    userRepository.count.mockResolvedValue(0);
    roleRepository.findOne.mockResolvedValue(null);
    roleRepository.create.mockReturnValue(role);
    roleRepository.save.mockResolvedValue(role);
    permissionRepository.find.mockResolvedValue([]);
    permissionRepository.create.mockImplementation((data) => data as PermissionEntity);
    permissionRepository.save.mockResolvedValue([] as unknown as PermissionEntity);
    menuRepository.count.mockResolvedValue(0);
    menuRepository.create.mockImplementation((data) => data as MenuEntity);
    menuRepository.save
      .mockResolvedValueOnce(
        Object.assign(new MenuEntity(), {
          id: 10,
          name: '系统管理',
          path: '/system',
        }),
      )
      .mockImplementationOnce(async (data) => data as unknown as MenuEntity);
    userRepository.create.mockImplementation((data) => Object.assign(user, data));
    userRepository.save.mockResolvedValue(user);

    await service.onApplicationBootstrap();

    expect(userRepository.count).toHaveBeenCalledWith({ withDeleted: true });
    expect(roleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'super_admin',
        category: RoleCategory.SYSTEM,
        isSystem: true,
      }),
    );
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'admin',
        email: 'admin@local.home',
        status: UserStatus.ACTIVE,
        roles: [role],
      }),
    );
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        password: expect.stringMatching(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{16,}$/),
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Initial admin account'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('username: admin'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('password: '));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('shown only once'));
    expect(permissionRepository.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'user:create',
          isSystem: true,
        }),
        expect.objectContaining({
          code: 'api-app:key:create',
          isSystem: true,
        }),
        expect.objectContaining({
          code: 'task:create',
          isSystem: true,
        }),
        expect.objectContaining({
          code: 'task:complete',
          isSystem: true,
        }),
      ]),
    );
    expect(menuRepository.count).toHaveBeenCalled();
    expect(menuRepository.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: '系统管理',
        path: '/system',
      }),
    );
    expect(menuRepository.save).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({
          name: '用户管理',
          parentId: 10,
        }),
        expect.objectContaining({
          name: '角色管理',
          parentId: 10,
        }),
        expect.objectContaining({
          name: '菜单管理',
          parentId: 10,
        }),
        expect.objectContaining({
          name: '权限管理',
          parentId: 10,
        }),
        expect.objectContaining({
          name: 'API应用',
          parentId: 10,
        }),
        expect.objectContaining({
          name: '文件管理',
          parentId: 10,
        }),
        expect.objectContaining({
          name: '文件清理',
          path: '/system/file-cleanup',
          component: 'FileCleanupPage',
          parentId: 10,
          sort: 85,
        }),
        expect.objectContaining({
          name: '通知中心',
          parentId: 10,
        }),
        expect.objectContaining({
          name: '任务中心',
          path: '/tasks',
          component: 'TaskCenterPage',
          parentId: null,
        }),
        expect.objectContaining({
          name: '家庭内容',
          path: '/family-content',
          component: 'FamilyContentPage',
          parentId: null,
        }),
      ]),
    );
  });

  it('已有用户时补齐默认权限和默认业务菜单但不重新创建 admin 或输出密码', async () => {
    const role = Object.assign(new RoleEntity(), {
      id: 1,
      code: 'super_admin',
      name: '超级管理员',
      category: RoleCategory.SYSTEM,
      isActive: true,
      isSystem: true,
    });

    userRepository.count.mockResolvedValue(1);
    roleRepository.findOne.mockResolvedValue(role);
    permissionRepository.find.mockResolvedValue([]);
    permissionRepository.create.mockImplementation((data) => data as PermissionEntity);
    permissionRepository.save.mockResolvedValue([] as unknown as PermissionEntity);
    menuRepository.count.mockResolvedValue(1);
    menuRepository.findOne.mockResolvedValue(null);
    menuRepository.create.mockImplementation((data) => data as MenuEntity);
    menuRepository.save.mockImplementation(async (data) => data as unknown as MenuEntity);

    await service.onApplicationBootstrap();

    expect(userRepository.count).toHaveBeenCalledWith({ withDeleted: true });
    expect(userRepository.create).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('password: '));
    expect(permissionRepository.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'task:read',
          isSystem: true,
        }),
      ]),
    );
    expect(menuRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '任务中心',
        path: '/tasks',
        component: 'TaskCenterPage',
        parentId: null,
      }),
    );
    expect(menuRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '家庭内容',
        path: '/family-content',
        component: 'FamilyContentPage',
        parentId: null,
      }),
    );
    expect(menuRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '文件清理',
        path: '/system/file-cleanup',
        component: 'FileCleanupPage',
      }),
    );
  });

  it('已有默认菜单时只同步路由关键字段并保留用户可配置的图标', async () => {
    const role = Object.assign(new RoleEntity(), {
      id: 1,
      code: 'super_admin',
      name: '超级管理员',
      category: RoleCategory.SYSTEM,
      isActive: true,
      isSystem: true,
    });
    const staleTaskMenu = Object.assign(new MenuEntity(), {
      id: 42,
      name: '我的任务',
      path: '/tasks',
      component: 'OldTaskPage',
      parentId: 99,
      icon: null,
    });
    const insuranceMenu = Object.assign(new MenuEntity(), {
      id: 43,
      path: '/insurance',
      component: 'InsurancePage',
      parentId: null,
    });
    const familyContentMenu = Object.assign(new MenuEntity(), {
      id: 45,
      path: '/family-content',
      component: 'OldFamilyPage',
      parentId: 10,
    });
    const systemMenu = Object.assign(new MenuEntity(), {
      id: 10,
      path: '/system',
    });
    const automationMenu = Object.assign(new MenuEntity(), {
      id: 44,
      path: '/system/automation',
      component: 'system/automation',
      parentId: 10,
    });

    userRepository.count.mockResolvedValue(1);
    roleRepository.findOne.mockResolvedValue(role);
    permissionRepository.find.mockResolvedValue([]);
    permissionRepository.create.mockImplementation((data) => data as PermissionEntity);
    permissionRepository.save.mockResolvedValue([] as unknown as PermissionEntity);
    menuRepository.count.mockResolvedValue(1);
    menuRepository.create.mockImplementation((data) => data as MenuEntity);
    menuRepository.findOne.mockImplementation(async (options: any) => {
      switch (options.where?.path) {
        case '/tasks':
          return staleTaskMenu;
        case '/insurance':
          return insuranceMenu;
        case '/family-content':
          return familyContentMenu;
        case '/system':
          return systemMenu;
        case '/system/automation':
          return automationMenu;
        default:
          return null;
      }
    });
    menuRepository.save.mockImplementation(async (data) => data as unknown as MenuEntity);

    await service.onApplicationBootstrap();

    expect(menuRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 42,
        path: '/tasks',
        component: 'TaskCenterPage',
        parentId: null,
        icon: null,
      }),
    );
    expect(menuRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 45,
        path: '/family-content',
        component: 'FamilyContentPage',
        parentId: null,
      }),
    );
    expect(menuRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '文件清理',
        path: '/system/file-cleanup',
        component: 'FileCleanupPage',
        parentId: 10,
      }),
    );
  });
});
