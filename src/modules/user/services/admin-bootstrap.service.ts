import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { Repository } from 'typeorm';
import { UserStatus } from '~/common/enums/user.enum';
import { LoggerService } from '~/shared/logger/logger.service';
import { RoleCategory, RoleEntity } from '~/modules/role/entities/role.entity';
import { MenuEntity, MenuType } from '~/modules/menu/entities/menu.entity';
import { PermissionEntity } from '~/modules/permission/entities/permission.entity';
import { UserEntity } from '../entities/user.entity';

type DefaultMenuDefinition = Partial<MenuEntity> & { path: string };

const ROUTE_MANAGED_MENU_FIELDS = ['type', 'component', 'parentId'] as const;

const DEFAULT_SYSTEM_PERMISSIONS = [
  { code: 'user:create', name: '创建用户', module: 'user', sort: 10 },
  { code: 'user:read', name: '查看用户', module: 'user', sort: 20 },
  { code: 'user:update', name: '更新用户', module: 'user', sort: 30 },
  { code: 'user:delete', name: '删除用户', module: 'user', sort: 40 },
  { code: 'user:password:reset', name: '重置用户密码', module: 'user', sort: 50 },
  { code: 'role:create', name: '创建角色', module: 'role', sort: 10 },
  { code: 'role:read', name: '查看角色', module: 'role', sort: 20 },
  { code: 'role:update', name: '更新角色', module: 'role', sort: 30 },
  { code: 'role:delete', name: '删除角色', module: 'role', sort: 40 },
  { code: 'role:assign', name: '分配用户角色', module: 'role', sort: 50 },
  { code: 'role:access:assign', name: '分配角色授权', module: 'role', sort: 55 },
  { code: 'role:permission:assign', name: '分配角色权限', module: 'role', sort: 60 },
  { code: 'role:menu:assign', name: '分配角色菜单', module: 'role', sort: 70 },
  { code: 'role:menu:read', name: '查看角色菜单', module: 'role', sort: 80 },
  { code: 'role:menu:revoke', name: '移除角色菜单', module: 'role', sort: 90 },
  { code: 'permission:create', name: '创建权限', module: 'permission', sort: 10 },
  { code: 'permission:read', name: '查看权限', module: 'permission', sort: 20 },
  { code: 'permission:update', name: '更新权限', module: 'permission', sort: 30 },
  { code: 'permission:delete', name: '删除权限', module: 'permission', sort: 40 },
  { code: 'menu:create', name: '创建菜单', module: 'menu', sort: 10 },
  { code: 'menu:read', name: '查看菜单', module: 'menu', sort: 20 },
  { code: 'menu:update', name: '更新菜单', module: 'menu', sort: 30 },
  { code: 'menu:delete', name: '删除菜单', module: 'menu', sort: 40 },
  { code: 'file:upload', name: '上传文件', module: 'file', sort: 10 },
  { code: 'file:read', name: '查看文件', module: 'file', sort: 20 },
  { code: 'file:download', name: '下载文件', module: 'file', sort: 30 },
  { code: 'file:delete', name: '删除文件', module: 'file', sort: 40 },
  { code: 'notification:create', name: '创建通知', module: 'notification', sort: 10 },
  { code: 'notification:read', name: '查看通知', module: 'notification', sort: 20 },
  { code: 'api-app:create', name: '创建 API 应用', module: 'api-auth', sort: 10 },
  { code: 'api-app:read', name: '查看 API 应用', module: 'api-auth', sort: 20 },
  { code: 'api-app:update', name: '更新 API 应用', module: 'api-auth', sort: 30 },
  { code: 'api-app:delete', name: '删除 API 应用', module: 'api-auth', sort: 40 },
  { code: 'api-app:key:create', name: '创建 API 密钥', module: 'api-auth', sort: 50 },
  { code: 'api-app:key:read', name: '查看 API 密钥', module: 'api-auth', sort: 60 },
  { code: 'api-app:key:delete', name: '删除 API 密钥', module: 'api-auth', sort: 70 },
  { code: 'task:create', name: '创建任务', module: 'task', sort: 10 },
  { code: 'task:read', name: '查看任务', module: 'task', sort: 20 },
  { code: 'task:update', name: '更新任务', module: 'task', sort: 30 },
  { code: 'task:delete', name: '删除任务', module: 'task', sort: 40 },
  { code: 'task:complete', name: '完成任务', module: 'task', sort: 50 },
  { code: 'task-list:manage', name: '管理任务清单', module: 'task', sort: 60 },
  { code: 'insurance:create', name: '创建保单', module: 'insurance', sort: 10 },
  { code: 'insurance:read', name: '查看保单', module: 'insurance', sort: 20 },
  { code: 'insurance:update', name: '更新保单', module: 'insurance', sort: 30 },
  { code: 'insurance:delete', name: '删除保单', module: 'insurance', sort: 40 },
  { code: 'insurance-member:manage', name: '管理保险成员', module: 'insurance', sort: 50 },
  { code: 'baby:read', name: '查看宝宝档案', module: 'baby', sort: 10 },
  { code: 'baby:update', name: '维护宝宝档案', module: 'baby', sort: 20 },
  { code: 'automation:read', name: '查看自动化任务', module: 'automation', sort: 10 },
  { code: 'automation:update', name: '更新自动化任务配置', module: 'automation', sort: 20 },
  { code: 'automation:execute', name: '执行自动化任务', module: 'automation', sort: 30 },
] as const;

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private static readonly ADMIN_USERNAME = 'admin';
  private static readonly ADMIN_EMAIL = 'admin@local.home';

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(MenuEntity)
    private readonly menuRepository: Repository<MenuEntity>,
    @InjectRepository(PermissionEntity)
    private readonly permissionRepository: Repository<PermissionEntity>,
    private readonly logger: LoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const userCount = await this.userRepository.count({ withDeleted: true });
    const role = await this.ensureSuperAdminRole();
    await this.ensureDefaultPermissions();
    await this.ensureDefaultMenus();

    if (userCount > 0) {
      return;
    }

    const password = this.generatePassword();
    const admin = this.userRepository.create({
      username: AdminBootstrapService.ADMIN_USERNAME,
      email: AdminBootstrapService.ADMIN_EMAIL,
      password,
      realName: '系统管理员',
      status: UserStatus.ACTIVE,
      roles: [role],
    });

    await this.userRepository.save(admin);
    this.logInitialAdmin(password);
  }

  private async ensureSuperAdminRole(): Promise<RoleEntity> {
    const existing = await this.roleRepository.findOne({
      where: { code: 'super_admin' },
    });

    if (existing) {
      return existing;
    }

    const role = this.roleRepository.create({
      code: 'super_admin',
      name: '超级管理员',
      description: '系统初始化创建的超级管理员角色',
      category: RoleCategory.SYSTEM,
      sort: 0,
      isActive: true,
      isSystem: true,
    });

    return this.roleRepository.save(role);
  }

  private async ensureDefaultPermissions(): Promise<void> {
    const existingPermissions = await this.permissionRepository.find({
      select: ['code'],
    });
    const existingCodes = new Set(existingPermissions.map((permission) => permission.code));
    const permissionsToCreate = DEFAULT_SYSTEM_PERMISSIONS.filter(
      (permission) => !existingCodes.has(permission.code),
    );

    if (permissionsToCreate.length === 0) {
      return;
    }

    await this.permissionRepository.save(
      this.permissionRepository.create(
        permissionsToCreate.map((permission) => ({
          ...permission,
          isActive: true,
          isSystem: true,
        })),
      ),
    );

    this.logger.log(`Initialized ${permissionsToCreate.length} system permissions`);
  }

  private async ensureDefaultMenus(): Promise<void> {
    const menuCount = await this.menuRepository.count();
    if (menuCount > 0) {
      await this.ensureDefaultMenu(this.createTaskCenterMenu());
      await this.ensureDefaultMenu(this.createInsuranceMenu());
      await this.ensureDefaultMenu(this.createFamilyContentMenu());
      await this.ensureDefaultMenu(this.createBabyProfileMenu());
      const systemMenu = await this.ensureSystemMenu();
      await this.ensureDefaultMenu(this.createAutomationMenu(systemMenu.id));
      await this.ensureDefaultMenu(this.createFileCleanupMenu(systemMenu.id));
      return;
    }

    const savedSystemMenu = await this.ensureSystemMenu();

    const menus = this.menuRepository.create([
      this.createTaskCenterMenu(),
      this.createInsuranceMenu(),
      this.createFamilyContentMenu(),
      this.createBabyProfileMenu(),
      {
        name: '用户管理',
        path: '/system/users',
        type: MenuType.MENU,
        icon: 'user',
        component: 'system/users',
        parentId: savedSystemMenu.id,
        sort: 20,
        isVisible: true,
        isActive: true,
      },
      {
        name: '角色管理',
        path: '/system/roles',
        type: MenuType.MENU,
        icon: 'team',
        component: 'system/roles',
        parentId: savedSystemMenu.id,
        sort: 30,
        isVisible: true,
        isActive: true,
      },
      {
        name: '菜单管理',
        path: '/system/menus',
        type: MenuType.MENU,
        icon: 'menu',
        component: 'system/menus',
        parentId: savedSystemMenu.id,
        sort: 40,
        isVisible: true,
        isActive: true,
      },
      {
        name: '权限管理',
        path: '/system/permissions',
        type: MenuType.MENU,
        icon: 'safety',
        component: 'system/permissions',
        parentId: savedSystemMenu.id,
        sort: 50,
        isVisible: true,
        isActive: true,
      },
      {
        name: 'API应用',
        path: '/system/api-apps',
        type: MenuType.MENU,
        icon: 'api',
        component: 'system/api-apps',
        parentId: savedSystemMenu.id,
        sort: 60,
        isVisible: true,
        isActive: true,
      },
      {
        ...this.createAutomationMenu(savedSystemMenu.id),
      },
      {
        name: '文件管理',
        path: '/system/files',
        type: MenuType.MENU,
        icon: 'folder',
        component: 'system/files',
        parentId: savedSystemMenu.id,
        sort: 80,
        isVisible: true,
        isActive: true,
      },
      {
        ...this.createFileCleanupMenu(savedSystemMenu.id),
      },
      {
        name: '通知中心',
        path: '/system/notifications',
        type: MenuType.MENU,
        icon: 'notification',
        component: 'system/notifications',
        parentId: savedSystemMenu.id,
        sort: 90,
        isVisible: true,
        isActive: true,
      },
    ]);

    await this.menuRepository.save(menus);
  }

  private async ensureDefaultMenu(defaultMenu: DefaultMenuDefinition): Promise<MenuEntity> {
    const existing = await this.menuRepository.findOne({
      where: { path: defaultMenu.path },
    });

    if (existing) {
      const patch = this.getDefaultMenuRoutePatch(existing, defaultMenu);
      if (Object.keys(patch).length === 0) {
        return existing;
      }

      Object.assign(existing, patch);
      return this.menuRepository.save(existing);
    }

    return this.menuRepository.save(this.menuRepository.create(defaultMenu));
  }

  private getDefaultMenuRoutePatch(
    existing: MenuEntity,
    defaultMenu: DefaultMenuDefinition,
  ): Partial<MenuEntity> {
    const patch: Partial<MenuEntity> = {};
    for (const field of ROUTE_MANAGED_MENU_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(defaultMenu, field)) {
        continue;
      }

      if (existing[field] !== defaultMenu[field]) {
        (patch as any)[field] = defaultMenu[field];
      }
    }

    return patch;
  }

  private async ensureSystemMenu(): Promise<MenuEntity> {
    return this.ensureDefaultMenu(this.createSystemMenu());
  }

  private createSystemMenu(): DefaultMenuDefinition {
    return {
      name: '系统管理',
      path: '/system',
      type: MenuType.DIRECTORY,
      icon: 'setting',
      sort: 10,
      isVisible: true,
      isActive: true,
    };
  }

  private createTaskCenterMenu(): DefaultMenuDefinition {
    return {
      name: '任务中心',
      path: '/tasks',
      type: MenuType.MENU,
      icon: 'check-square',
      component: 'TaskCenterPage',
      parentId: null,
      sort: 15,
      isVisible: true,
      isActive: true,
    };
  }

  private createInsuranceMenu(): DefaultMenuDefinition {
    return {
      name: '家庭保险',
      path: '/insurance',
      type: MenuType.MENU,
      icon: 'safety',
      component: 'InsurancePage',
      parentId: null,
      sort: 16,
      isVisible: true,
      isActive: true,
    };
  }

  private createFamilyContentMenu(): DefaultMenuDefinition {
    return {
      name: '家庭内容',
      path: '/family-content',
      type: MenuType.MENU,
      icon: 'team',
      component: 'FamilyContentPage',
      parentId: null,
      sort: 17,
      isVisible: true,
      isActive: true,
    };
  }

  private createBabyProfileMenu(): DefaultMenuDefinition {
    return {
      name: '宝宝档案',
      path: '/baby',
      type: MenuType.MENU,
      icon: 'heart',
      component: 'BabyProfilePage',
      parentId: null,
      sort: 18,
      isVisible: true,
      isActive: true,
    };
  }

  private createAutomationMenu(parentId: number): DefaultMenuDefinition {
    return {
      name: '自动化任务',
      path: '/system/automation',
      type: MenuType.MENU,
      icon: 'clock-circle',
      component: 'system/automation',
      parentId,
      sort: 70,
      isVisible: true,
      isActive: true,
    };
  }

  private createFileCleanupMenu(parentId: number): DefaultMenuDefinition {
    return {
      name: '文件清理',
      path: '/system/file-cleanup',
      type: MenuType.MENU,
      icon: 'delete',
      component: 'FileCleanupPage',
      parentId,
      sort: 85,
      isVisible: true,
      isActive: true,
    };
  }

  private generatePassword(length = 20): string {
    const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789'];
    const specials = '@$!%*?&_-';
    const allChars = groups.join('') + specials;
    const chars = [...groups.map((group) => this.pick(group))];

    while (chars.length < length) {
      chars.push(this.pick(allChars));
    }

    return this.shuffle(chars).join('');
  }

  private pick(chars: string): string {
    return chars[randomInt(chars.length)];
  }

  private shuffle(chars: string[]): string[] {
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars;
  }

  private logInitialAdmin(password: string): void {
    this.logger.warn('Initial admin account created');
    this.logger.warn(`username: ${AdminBootstrapService.ADMIN_USERNAME}`);
    this.logger.warn(`password: ${password}`);
    this.logger.warn('This password is shown only once. Change it after login.');
  }
}
