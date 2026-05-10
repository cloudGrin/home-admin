import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const projectRoot = join(__dirname, '..');
const sourceRoot = __dirname;

const readSource = (path: string) => readFileSync(join(sourceRoot, path), 'utf8');
const existsInSource = (path: string) => existsSync(join(sourceRoot, path));
const readProject = (path: string) => readFileSync(join(projectRoot, path), 'utf8');
const readEnvKeys = (path: string) =>
  readProject(path)
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
    .filter(Boolean);
const readAllMigrations = () =>
  readdirSync(join(sourceRoot, 'migrations'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readSource(`migrations/${file}`))
    .join('\n');

describe('architecture slimming', () => {
  it('does not load generic scaffold modules without current business usage', () => {
    const appModule = readSource('app.module.ts');

    expect(appModule).not.toContain('DictModule');
    expect(appModule).not.toContain('SystemConfigModule');
    expect(existsInSource('modules/dict')).toBe(false);
    expect(existsInSource('modules/config')).toBe(false);
  });

  it('keeps task scheduling as registered code tasks, not a workflow platform', () => {
    const appModule = readSource('app.module.ts');
    const registry = readSource('modules/automation/services/automation-task-registry.service.ts');
    const migrations = readAllMigrations();

    expect(appModule).toContain('AutomationModule');
    expect(registry).toContain('this.register({');
    expect(migrations).toContain('automation_task_configs');
    expect(migrations).toContain('automation_task_logs');
    expect(migrations).not.toContain('task_definitions');
    expect(existsInSource('modules/workflow')).toBe(false);
  });

  it('keeps file module to direct upload/download/list/delete only', () => {
    const controller = readSource('modules/file/controllers/file.controller.ts');
    const service = readSource('modules/file/services/file.service.ts');
    const configuration = readSource('config/configuration.ts');

    expect(controller).not.toContain('upload/chunk');
    expect(controller).not.toContain('signed-url');
    expect(service).not.toContain('uploadChunk');
    expect(service).not.toContain('generateDownloadUrl');
    expect(service).not.toContain('processImageIfNeeded');
    expect(configuration).not.toContain('thumbnail');
  });

  it('keeps api auth to apps, keys, scopes and active status only', () => {
    const appEntity = readSource('modules/api-auth/entities/api-app.entity.ts');
    const dto = readSource('modules/api-auth/dto/create-api-app.dto.ts');
    const service = readSource('modules/api-auth/services/api-auth.service.ts');
    const strategy = readSource('modules/api-auth/strategies/simple-api-key.strategy.ts');
    const module = readSource('modules/api-auth/api-auth.module.ts');
    const packageJson = readProject('package.json');

    for (const token of [
      'callbackUrl',
      'webhookUrl',
      'ipWhitelist',
      'rate_limit',
      'rateLimitPerHour',
      'rateLimitPerDay',
    ]) {
      expect(appEntity).not.toContain(token);
      expect(dto).not.toContain(token);
    }

    expect(service).not.toContain('ApiCallLog');
    expect(service).not.toContain('checkRateLimit');
    expect(service).not.toContain('getApiStatistics');
    expect(strategy).not.toContain('ipaddr');
    expect(strategy).not.toContain('checkRateLimit');
    expect(module).not.toContain('ApiCallLog');
    expect(packageJson).not.toContain('"ipaddr.js"');
  });

  it('keeps open APIs as thin adapters without platform architecture layers', () => {
    const readme = readProject('README.md');
    const apiAuthQuickstart = readProject('API_AUTH_QUICKSTART.md');
    const appModule = readSource('app.module.ts');
    const openApiModule = readSource('modules/open-api/open-api.module.ts');
    const openApiController = readSource('modules/open-api/controllers/open-api.controller.ts');
    const openApiRequestTypes = readSource('modules/open-api/types/request.types.ts');
    const apiAppDto = readSource('modules/api-auth/dto/create-api-app.dto.ts');

    expect(existsInSource('application')).toBe(false);
    expect(existsInSource('domain')).toBe(false);
    expect(existsInSource('modules/open-api/adapters')).toBe(false);
    expect(openApiModule).not.toContain('Adapter');
    expect(openApiController).not.toContain('req.app');
    expect(openApiRequestTypes).toContain('req.user');
    expect(openApiRequestTypes).not.toContain('req.app');
    expect(appModule).not.toContain('EventEmitter');

    for (const content of [apiAppDto]) {
      expect(content).not.toMatch(/数据服务平台|企业中台|中台化/);
      expect(content).not.toMatch(/E-commerce Platform|电商平台/);
    }

    expect(readme).toContain('Open APIs are thin adapters over existing services');
    expect(apiAuthQuickstart).toContain('do not introduce a separate domain/application layer');
  });

  it('removes unused api statistics endpoints and RBAC placeholder endpoints', () => {
    const openApiController = readSource('modules/open-api/controllers/open-api.controller.ts');
    const apiAppController = readSource('modules/api-auth/controllers/api-app.controller.ts');
    const roleController = readSource('modules/role/controllers/role.controller.ts');
    const roleService = readSource('modules/role/services/role.service.ts');

    expect(openApiController).not.toContain('statistics');
    expect(apiAppController).not.toContain('statistics');
    expect(roleController).not.toContain('effective-permissions');
    expect(roleController).not.toContain('check-exclusive');
    expect(roleService).not.toContain('getEffectivePermissions');
    expect(roleService).not.toContain('checkExclusiveConflict');
    expect(existsInSource('modules/permission/dto/set-permissions.dto.ts')).toBe(false);
  });

  it('keeps permission records to the fields currently enforced by guards', () => {
    const permissionEntity = readSource('modules/permission/entities/permission.entity.ts');
    const createPermissionDto = readSource('modules/permission/dto/create-permission.dto.ts');
    const queryPermissionDto = readSource('modules/permission/dto/query-permission.dto.ts');
    const migration = readSource('migrations/1730000000000-InitSchema.ts');

    expect(permissionEntity).not.toContain('PermissionType');
    expect(permissionEntity).not.toContain('type: PermissionType');
    expect(createPermissionDto).not.toContain('PermissionType');
    expect(createPermissionDto).not.toContain('type:');
    expect(queryPermissionDto).not.toContain('PermissionType');
    expect(permissionEntity).not.toContain('httpMeta');
    expect(permissionEntity).not.toContain('deprecated');
    expect(permissionEntity).not.toContain('replaceBy');
    expect(permissionEntity).not.toContain('extra?:');
    expect(createPermissionDto).not.toContain('httpMeta');
    expect(createPermissionDto).not.toContain('extra?:');
    expect(queryPermissionDto).not.toContain('type?:');
    expect(migration).not.toContain("type enum('api', 'feature')");
    expect(migration).not.toContain('httpMeta json');
    expect(migration).not.toContain("extra json NULL COMMENT '扩展配置'");
  });

  it('does not provide CacheClearService as a parallel cache invalidation abstraction', () => {
    const cacheModule = readSource('shared/cache/cache.module.ts');

    expect(cacheModule).not.toContain('CacheClearService');
    expect(existsInSource('shared/cache/cache-clear.service.ts')).toBe(false);
  });

  it('keeps menu authorization to role-menu mapping only, without display conditions or lock-heavy moves', () => {
    const menuEntity = readSource('modules/menu/entities/menu.entity.ts');
    const createMenuDto = readSource('modules/menu/dto/create-menu.dto.ts');
    const menuService = readSource('modules/menu/services/menu.service.ts');
    const migration = readSource('migrations/1730000000000-InitSchema.ts');

    expect(menuEntity).not.toContain('displayCondition');
    expect(createMenuDto).not.toContain('displayCondition');
    expect(menuService).not.toContain('async getUserMenus(');
    expect(menuService).not.toContain('pessimistic_write');
    expect(menuService).not.toContain('pessimistic_read');
    expect(migration).not.toContain('displayCondition json');
  });

  it('keeps menu schema to fields currently consumed by routing and navigation', () => {
    const menuEntity = readSource('modules/menu/entities/menu.entity.ts');
    const createMenuDto = readSource('modules/menu/dto/create-menu.dto.ts');
    const menuService = readSource('modules/menu/services/menu.service.ts');
    const cleanupMigration = readSource('migrations/1810000000000-DropUnusedMenuFields.ts');

    expect(menuEntity).not.toContain('isCache');
    expect(menuEntity).not.toContain('meta?:');
    expect(createMenuDto).not.toContain('isCache');
    expect(createMenuDto).not.toContain('meta?:');
    expect(menuService).not.toContain('meta:');
    expect(cleanupMigration).toContain('DROP COLUMN isCache');
    expect(cleanupMigration).toContain('DROP COLUMN meta');
  });

  it('removes parallel role-guard auth, stale register flow, and unused CRUD scaffold', () => {
    const authModule = readSource('modules/auth/auth.module.ts');
    const roleController = readSource('modules/role/controllers/role.controller.ts');
    const authService = readSource('modules/auth/services/auth.service.ts');
    const authController = readSource('modules/auth/controllers/auth.controller.ts');
    const mockFactory = readSource('test-utils/mock-factory.ts');

    expect(authModule).not.toContain('RolesGuard');
    expect(roleController).not.toContain('AdminOnly');
    expect(authService).not.toContain('async register(');
    expect(authController).not.toContain("@Post('register')");
    expect(mockFactory).not.toContain('RegisterDtoMockFactory');
    expect(existsInSource('modules/auth/guards/roles.guard.ts')).toBe(false);
    expect(existsInSource('modules/auth/decorators/roles.decorator.ts')).toBe(false);
    expect(existsInSource('modules/auth/dto/register.dto.ts')).toBe(false);
    expect(existsInSource('core/base/crud.controller.ts')).toBe(false);
  });

  it('removes stale register references from e2e tests and helpers', () => {
    const authE2e = readProject('test/auth.e2e-spec.ts');
    const testHelper = readProject('test/test-helper.ts');

    expect(authE2e).not.toContain('/auth/register');
    expect(authE2e).not.toContain('POST /auth/register');
    expect(testHelper).not.toContain('/auth/register');
    expect(testHelper).not.toContain('registerTestUser');
    expect(testHelper).not.toContain('registerSuperAdmin');
  });

  it('removes unused open api order placeholder DTOs', () => {
    const apiAuthQuickstart = readProject('API_AUTH_QUICKSTART.md');

    expect(existsInSource('modules/open-api/dto/create-order.dto.ts')).toBe(false);
    expect(existsInSource('modules/open-api/dto/query-order.dto.ts')).toBe(false);
    expect(apiAuthQuickstart).not.toContain('/open/orders');
    expect(apiAuthQuickstart).not.toContain('/open/statistics');
    expect(apiAuthQuickstart).not.toContain('/webhooks/subscribe');
  });

  it('removes unused custom validation pipe in favor of Nest built-in ValidationPipe', () => {
    const main = readSource('main.ts');
    const configureApp = readSource('bootstrap/configure-app.ts');

    expect(main).toContain("from './bootstrap/configure-app'");
    expect(configureApp).toContain("from '@nestjs/common'");
    expect(configureApp).toContain('new ValidationPipe({');
    expect(existsInSource('core/pipes/validation.pipe.ts')).toBe(false);
  });

  it('removes tracked backup files and starter package metadata', () => {
    const packageJson = readProject('package.json');

    expect(existsSync(join(projectRoot, 'test/notification.e2e-spec.ts.backup'))).toBe(false);
    expect(packageJson).not.toContain('nestjs-starter-pro');
    expect(packageJson).not.toContain('YOUR_USERNAME');
    expect(packageJson).toContain('"private": true');
  });

  it('uses DTO validation for open api user query instead of runtime-only interfaces', () => {
    const openApiController = readSource('modules/open-api/controllers/open-api.controller.ts');
    const dto = readSource('modules/open-api/dto/open-user-list-query.dto.ts');

    expect(openApiController).not.toContain('interface UserListQuery');
    expect(openApiController).toContain('OpenUserListQueryDto');
    expect(dto).toContain('class OpenUserListQueryDto');
  });

  it('uses native swagger response decorators instead of a custom response wrapper layer', () => {
    const decoratorIndex = readSource('core/decorators/index.ts');
    const authController = readSource('modules/auth/controllers/auth.controller.ts');
    const userController = readSource('modules/user/controllers/user.controller.ts');
    const roleController = readSource('modules/role/controllers/role.controller.ts');
    const permissionController = readSource(
      'modules/permission/controllers/permission.controller.ts',
    );
    const menuController = readSource('modules/menu/controllers/menu.controller.ts');
    const fileController = readSource('modules/file/controllers/file.controller.ts');
    const notificationController = readSource(
      'modules/notification/controllers/notification.controller.ts',
    );
    expect(existsInSource('core/decorators/api-response.decorator.ts')).toBe(false);
    expect(existsInSource('core/decorators/api-docs.decorator.ts')).toBe(false);
    expect(existsInSource('core/decorators/api-example.decorator.ts')).toBe(false);
    expect(decoratorIndex).not.toContain("export * from './api-response.decorator'");
    expect(decoratorIndex).not.toContain("export * from './api-docs.decorator'");
    expect(decoratorIndex).not.toContain("export * from './api-example.decorator'");
    expect(authController).not.toContain('ApiSuccessResponse');
    expect(authController).not.toContain('ApiPublicResponses');
    expect(authController).not.toContain('ApiAuthResponses');
    expect(authController).not.toContain('ApiLoginExample');
    expect(userController).not.toContain('ApiSuccessResponse');
    expect(userController).not.toContain('ApiPaginatedResponse');
    expect(userController).not.toContain('ApiCommonResponses');
    expect(roleController).not.toContain('ApiSuccessResponse');
    expect(roleController).not.toContain('ApiPaginatedResponse');
    expect(permissionController).not.toContain('ApiSuccessResponse');
    expect(permissionController).not.toContain('ApiPaginatedResponse');
    expect(menuController).not.toContain('ApiSuccessResponse');
    expect(fileController).not.toContain('ApiSuccessResponse');
    expect(fileController).not.toContain('ApiPaginatedResponse');
    expect(fileController).not.toContain('ApiCommonResponses');
    expect(notificationController).not.toContain('ApiSuccessResponse');
    expect(notificationController).not.toContain('ApiPaginatedResponse');
  });

  it('keeps notification delivery to direct bark/feishu adapters without manager and token indirection', () => {
    const notificationModule = readSource('modules/notification/notification.module.ts');
    const notificationService = readSource('modules/notification/services/notification.service.ts');
    const notificationEntity = readSource('modules/notification/entities/notification.entity.ts');
    const notificationDto = readSource('modules/notification/dto/create-notification.dto.ts');

    expect(notificationModule).not.toContain('NotificationChannelManager');
    expect(notificationModule).not.toContain('NOTIFICATION_CHANNEL_ADAPTERS');
    expect(notificationModule).toContain('HttpModule.register');
    expect(notificationModule).toContain('timeout: 5000');
    expect(notificationService).not.toContain('NotificationChannelManager');
    expect(notificationService).toContain('sendExternal');
    expect(notificationService).not.toContain('sendExternalWhenOffline');
    expect(notificationEntity).toContain('sendExternal');
    expect(notificationEntity).not.toContain('sendExternalWhenOffline');
    expect(notificationDto).toContain('sendExternal');
    expect(notificationDto).not.toContain('sendExternalWhenOffline');
    expect(existsInSource('modules/notification/channels/notification-channel.manager.ts')).toBe(
      false,
    );
    expect(existsInSource('modules/notification/channels/notification-channel.tokens.ts')).toBe(
      false,
    );
  });

  it('keeps current-user profile capability in user module only and avoids duplicate guard decoration', () => {
    const authController = readSource('modules/auth/controllers/auth.controller.ts');
    const apiAppController = readSource('modules/api-auth/controllers/api-app.controller.ts');
    const fileController = readSource('modules/file/controllers/file.controller.ts');
    const userController = readSource('modules/user/controllers/user.controller.ts');
    const menuController = readSource('modules/menu/controllers/menu.controller.ts');

    expect(authController).not.toContain("@Get('profile')");
    expect(authController).not.toContain("@Get('check')");
    expect(apiAppController).not.toContain('@UseGuards(JwtAuthGuard)');
    expect(apiAppController).toContain('@CurrentUser() user');
    expect(fileController).not.toContain('@Req() req');
    expect(fileController).not.toContain('const payload = req.body');
    expect(userController).toContain('@CurrentUser() user');
    expect(userController).not.toContain('@Req() req');
    expect(menuController).toContain('@CurrentUser() user');
    expect(menuController).not.toContain('@Req() req');
    expect(existsInSource('modules/api-auth/types/request.types.ts')).toBe(false);
  });

  it('removes unused audit and future-account fields from base/user schema', () => {
    const baseEntity = readSource('core/base/base.entity.ts');
    const userEntity = readSource('modules/user/entities/user.entity.ts');
    const userEnum = readSource('common/enums/user.enum.ts');
    const migration = readSource('migrations/1730000000000-InitSchema.ts');

    for (const token of ['createdBy', 'updatedBy', 'deletedBy']) {
      expect(baseEntity).not.toContain(token);
      expect(migration).not.toContain(token);
    }

    for (const token of [
      'isEmailVerified',
      'isPhoneVerified',
      'isTwoFactorEnabled',
      'twoFactorSecret',
      'settings',
      'extra?:',
    ]) {
      expect(userEntity).not.toContain(token);
      expect(migration).not.toContain(token);
    }

    expect(userEnum).not.toContain('UserType');
    expect(userEnum).not.toContain('LoginType');
  });

  it('keeps file storage and tree utilities to the methods used by current services', () => {
    const fileEntity = readSource('modules/file/entities/file.entity.ts');
    const queryFileDto = readSource('modules/file/dto/query-file.dto.ts');
    const fileService = readSource('modules/file/services/file.service.ts');
    const storageInterface = readSource('modules/file/storage/file-storage.interface.ts');
    const localStorage = readSource('modules/file/storage/local-storage.strategy.ts');
    const ossStorage = readSource('modules/file/storage/oss-storage.strategy.ts');
    const treeUtil = readSource('common/utils/tree.util.ts');
    const migration = readSource('migrations/1730000000000-InitSchema.ts');

    expect(fileEntity).not.toContain('FileStatus');
    expect(fileEntity).not.toContain('status:');
    expect(queryFileDto).not.toContain('status?:');
    expect(fileService).not.toContain('FileStatus');
    expect(fileService).not.toContain('file.status');
    expect(migration).not.toContain(
      "status enum('uploading', 'available', 'processing', 'failed')",
    );

    for (const method of ['saveFromPath', 'exists(', 'toAbsolutePath?']) {
      expect(storageInterface).not.toContain(method);
    }
    expect(localStorage).not.toContain('async saveFromPath');
    expect(localStorage).not.toContain('async exists');
    expect(ossStorage).not.toContain('async saveFromPath');
    expect(ossStorage).not.toContain('async exists');

    for (const method of [
      'treeToArray',
      'findNode',
      'findPath',
      'filterTree',
      'traverse',
      'mapTree',
      'getMaxDepth',
      'getLeafNodes',
      'sortTree',
      'addLevelInfo',
    ]) {
      expect(treeUtil).not.toContain(`static ${method}`);
    }
  });

  it('uses real DTOs for role controller query and mutation payloads instead of runtime-only inline types', () => {
    const roleController = readSource('modules/role/controllers/role.controller.ts');

    expect(roleController).toContain('QueryRoleDto');
    expect(roleController).toContain('UpdateRoleDto');
    expect(roleController).toContain('AssignPermissionsDto');
    expect(roleController).not.toContain('query: {');
    expect(roleController).not.toContain('Partial<CreateRoleDto>');
    expect(roleController).not.toContain('@Body() permissionIds: number[]');
  });

  it('uses DTOs and response mappers for menu path validation and open api user responses', () => {
    const menuController = readSource('modules/menu/controllers/menu.controller.ts');
    const openApiController = readSource('modules/open-api/controllers/open-api.controller.ts');
    const fileController = readSource('modules/file/controllers/file.controller.ts');

    expect(menuController).toContain('ValidateMenuPathDto');
    expect(menuController).not.toContain("@Query('path') path: string");
    expect(menuController).not.toContain("@Query('excludeId') excludeIdStr?: string");
    expect(menuController).not.toContain('parseInt(excludeIdStr, 10)');
    expect(openApiController).toContain('OpenUserListResponseDto');
    expect(openApiController).toContain('OpenApiUserService');
    expect(openApiController).not.toContain("from '~/modules/user/services/user.service'");
    expect(openApiController).not.toContain('findUsers(');
    expect(fileController).not.toContain('this.fileService.findOne(');
    expect(fileController).not.toContain("BusinessException.notFound('文件', id)");
  });

  it('keeps api app and notification command responses in explicit response DTOs', () => {
    const apiAppController = readSource('modules/api-auth/controllers/api-app.controller.ts');
    const notificationController = readSource(
      'modules/notification/controllers/notification.controller.ts',
    );

    expect(apiAppController).toContain('ApiAppDeleteResponseDto');
    expect(apiAppController).toContain('ApiKeyCreatedResponseDto');
    expect(apiAppController).toContain('ApiKeyListItemDto');
    expect(apiAppController).toContain('ApiKeyRevokeResponseDto');
    expect(apiAppController).not.toContain('return keys.map((key) => ({');
    expect(apiAppController).not.toContain("return { success: true, message: 'API应用已删除' }");
    expect(apiAppController).not.toContain("message: 'API密钥已撤销'");
    expect(notificationController).toContain('MarkNotificationReadResponseDto');
    expect(notificationController).toContain('MarkAllNotificationsReadResponseDto');
    expect(notificationController).not.toContain("return { message: '通知已标记为已读' }");
    expect(notificationController).not.toContain("message: '所有通知已标记为已读'");
  });

  it('keeps command responses in explicit DTOs instead of hand-written controller objects', () => {
    const authController = readSource('modules/auth/controllers/auth.controller.ts');
    const userController = readSource('modules/user/controllers/user.controller.ts');
    const roleController = readSource('modules/role/controllers/role.controller.ts');
    const permissionController = readSource(
      'modules/permission/controllers/permission.controller.ts',
    );
    const menuController = readSource('modules/menu/controllers/menu.controller.ts');

    for (const controller of [
      authController,
      userController,
      roleController,
      permissionController,
      menuController,
    ]) {
      expect(controller).not.toContain('return { message:');
    }

    expect(userController).not.toContain('return { permissions }');
    expect(userController).toContain('UserPermissionsResponseDto');
    expect(authController).toContain('MessageResponseDto');
    expect(roleController).toContain('MessageResponseDto');
    expect(permissionController).toContain('MessageResponseDto');
    expect(menuController).toContain('MessageResponseDto');
  });

  it('keeps api app pagination calculation in the service instead of controller', () => {
    const apiAppController = readSource('modules/api-auth/controllers/api-app.controller.ts');
    const apiAuthService = readSource('modules/api-auth/services/api-auth.service.ts');

    expect(apiAppController).toContain('this.apiAuthService.getApps(query)');
    expect(apiAppController).not.toContain('const skip =');
    expect(apiAppController).not.toContain('{ skip, take: limit }');
    expect(apiAppController).toContain('this.apiAuthService.createApp(dto, user.id)');
    expect(apiAppController).not.toContain('const dtoWithOwner');
    expect(apiAppController).not.toContain('ownerId: user.id');
    expect(apiAuthService).not.toContain('total: result.meta.totalItems');
    expect(apiAuthService).not.toContain('page: result.meta.currentPage');
    expect(apiAuthService).not.toContain('limit: result.meta.itemsPerPage');
  });

  it('uses DTOs for user controller array request bodies instead of bare arrays', () => {
    const userController = readSource('modules/user/controllers/user.controller.ts');

    expect(userController).toContain('DeleteUsersDto');
    expect(userController).toContain('AssignUserRolesDto');
    expect(userController).not.toContain('@Body() ids: number[]');
    expect(userController).not.toContain('@Body() roleIds: number[]');
  });

  it('removes BaseService inheritance from business services', () => {
    const userService = readSource('modules/user/services/user.service.ts');
    const roleService = readSource('modules/role/services/role.service.ts');
    const menuService = readSource('modules/menu/services/menu.service.ts');
    const permissionService = readSource('modules/permission/services/permission.service.ts');
    const fileService = readSource('modules/file/services/file.service.ts');
    const notificationService = readSource('modules/notification/services/notification.service.ts');

    expect(existsInSource('core/base/base.service.ts')).toBe(false);
    for (const service of [
      userService,
      roleService,
      menuService,
      permissionService,
      fileService,
      notificationService,
    ]) {
      expect(service).not.toContain('extends BaseService');
      expect(service).not.toContain("from '~/core/base/base.service'");
    }
  });

  it('removes BaseRepository inheritance from repositories and keeps only shared pagination types', () => {
    expect(existsInSource('core/base/base.repository.ts')).toBe(false);
    expect(existsInSource('modules/api-auth/repositories')).toBe(false);
    expect(existsInSource('modules/auth/repositories')).toBe(false);
    expect(existsInSource('modules/user/repositories')).toBe(false);
    expect(existsInSource('modules/role/repositories')).toBe(false);
    expect(existsInSource('modules/permission/repositories')).toBe(false);
    expect(existsInSource('modules/menu/repositories')).toBe(false);
    expect(existsInSource('modules/file/repositories')).toBe(false);
    expect(existsInSource('modules/notification/repositories')).toBe(false);
    expect(existsInSource('modules/api-auth/repositories/api-app.repository.ts')).toBe(false);
    expect(existsInSource('modules/api-auth/repositories/api-key.repository.ts')).toBe(false);
    expect(existsInSource('modules/auth/repositories/refresh-token.repository.ts')).toBe(false);
    expect(existsInSource('modules/user/repositories/user.repository.ts')).toBe(false);
    expect(existsInSource('modules/role/repositories/role.repository.ts')).toBe(false);
    expect(existsInSource('modules/permission/repositories/permission.repository.ts')).toBe(false);
    expect(existsInSource('modules/menu/repositories/menu.repository.ts')).toBe(false);
    expect(existsInSource('modules/file/repositories/file.repository.ts')).toBe(false);
    expect(existsInSource('modules/notification/repositories/notification.repository.ts')).toBe(
      false,
    );
  });

  it('does not keep unused broad app/cache constants after slimming cache paths', () => {
    expect(existsInSource('common/constants/app.constant.ts')).toBe(false);
    expect(existsInSource('common/constants/cache.constants.ts')).toBe(false);
    expect(existsInSource('common/constants')).toBe(false);
    expect(readSource('config/constants.ts')).not.toContain('ENVIRONMENTS');
  });

  it('removes unused scaffold directories and template utility files', () => {
    for (const path of [
      'common/helpers',
      'core/interfaces',
      'core/pipes',
      'modules/api-auth/types',
      'scripts',
      'shared/config',
      'shared/queue',
      'common/utils/array.util.ts',
      'common/utils/date.util.ts',
      'common/utils/object.util.ts',
    ]) {
      expect(existsInSource(path)).toBe(false);
    }

    const utilIndex = readSource('common/utils/index.ts');
    expect(utilIndex).not.toContain('array.util');
    expect(utilIndex).not.toContain('date.util');
    expect(utilIndex).not.toContain('object.util');
  });

  it('injects direct TypeORM repositories into menu, file, and notification services', () => {
    const menuModule = readSource('modules/menu/menu.module.ts');
    const menuService = readSource('modules/menu/services/menu.service.ts');
    const fileModule = readSource('modules/file/file.module.ts');
    const fileService = readSource('modules/file/services/file.service.ts');
    const notificationModule = readSource('modules/notification/notification.module.ts');
    const notificationService = readSource('modules/notification/services/notification.service.ts');

    expect(menuModule).not.toContain('MenuRepository');
    expect(menuService).not.toContain('MenuRepository');
    expect(menuService).toContain('@InjectRepository(MenuEntity)');
    expect(fileModule).not.toContain('FileRepository');
    expect(fileService).not.toContain('FileRepository');
    expect(fileService).toContain('@InjectRepository(FileEntity)');
    expect(notificationModule).not.toContain('NotificationRepository');
    expect(notificationService).not.toContain('NotificationRepository');
    expect(notificationService).toContain('@InjectRepository(NotificationEntity)');
  });

  it('reads bootstrap settings from structured config paths instead of raw env keys', () => {
    const main = readSource('main.ts');
    const bootstrap = readSource('bootstrap/configure-app.ts');
    const appModule = readSource('app.module.ts');
    const dataSource = readSource('config/data-source.ts');

    expect(main).toContain('configureApp(app, configService)');
    expect(bootstrap).toContain("configService.get<boolean>('app.trustProxy'");
    expect(bootstrap).toContain("set('trust proxy', true)");
    expect(bootstrap).toContain("configService.get<string | string[]>('cors.origin'");
    expect(bootstrap).toContain("configService.get<boolean>('cors.credentials'");
    expect(bootstrap).toContain("configService.get<string>('app.apiPrefix'");
    expect(bootstrap).toContain("configService.get<string>('app.apiVersion'");
    expect(bootstrap).toContain("configService.get<boolean>('swagger.enable'");
    expect(bootstrap).toContain("configService.get<string>('swagger.title'");
    expect(bootstrap).toMatch(/configService\.get<string>\(\s*'swagger\.description'/);
    expect(bootstrap).toContain("configService.get<string>('swagger.version'");
    expect(bootstrap).toContain("configService.get<string>('swagger.path'");
    expect(main).toContain("configService.get<number>('app.port'");
    expect(bootstrap).not.toContain("configService.get<string>('CORS_ORIGIN'");
    expect(bootstrap).not.toContain("configService.get<boolean>('CORS_CREDENTIALS'");
    expect(bootstrap).not.toContain("configService.get<string>('API_PREFIX'");
    expect(bootstrap).not.toContain("configService.get<string>('API_VERSION'");
    expect(bootstrap).not.toContain("configService.get<boolean>('SWAGGER_ENABLE'");
    expect(bootstrap).not.toContain("configService.get<string>('SWAGGER_TITLE'");
    expect(bootstrap).not.toContain("configService.get<string>('SWAGGER_DESCRIPTION'");
    expect(bootstrap).not.toContain("configService.get<string>('SWAGGER_VERSION'");
    expect(bootstrap).not.toContain("configService.get<string>('SWAGGER_PATH'");
    expect(main).not.toContain("configService.get<number>('PORT'");
    expect(appModule).toContain('resolveEnvFilePaths');
    expect(dataSource).toContain('resolveEnvFilePaths');
    expect(dataSource).toContain('override: true');
  });

  it('keeps shared infrastructure imported only at app root and avoids unnecessary global/export module patterns', () => {
    const appModule = readSource('app.module.ts');
    const sharedModule = readSource('shared/shared.module.ts');
    const authModule = readSource('modules/auth/auth.module.ts');
    const apiAuthModule = readSource('modules/api-auth/api-auth.module.ts');
    const healthModule = readSource('modules/health/health.module.ts');

    expect(sharedModule).toContain('@Global()');
    expect(appModule).toContain('SharedModule');
    expect(appModule).toContain(
      "import { DatabaseModule } from './shared/database/database.module'",
    );
    expect(appModule).toContain('DatabaseModule');
    expect(sharedModule).not.toContain('DatabaseModule');
    expect(authModule).not.toContain('@Global()');
    expect(authModule).not.toContain('exports: [AuthService, JwtModule]');
    expect(apiAuthModule).not.toContain('SharedModule');
    expect(existsInSource('modules/cron')).toBe(false);
    expect(healthModule).not.toContain('exports: [HealthService]');
  });

  it('injects direct TypeORM repositories for auth/api-auth instead of extra thin repository wrappers', () => {
    const apiAuthModule = readSource('modules/api-auth/api-auth.module.ts');
    const apiAuthService = readSource('modules/api-auth/services/api-auth.service.ts');
    const authModule = readSource('modules/auth/auth.module.ts');
    const authService = readSource('modules/auth/services/auth.service.ts');
    const userModule = readSource('modules/user/user.module.ts');
    const userService = readSource('modules/user/services/user.service.ts');
    const notificationService = readSource('modules/notification/services/notification.service.ts');
    const roleModule = readSource('modules/role/role.module.ts');
    const roleService = readSource('modules/role/services/role.service.ts');
    const permissionModule = readSource('modules/permission/permission.module.ts');
    const permissionService = readSource('modules/permission/services/permission.service.ts');

    expect(apiAuthModule).not.toContain('ApiAppRepository');
    expect(apiAuthModule).not.toContain('ApiKeyRepository');
    expect(apiAuthService).not.toContain('ApiAppRepository');
    expect(apiAuthService).not.toContain('ApiKeyRepository');
    expect(authModule).not.toContain('RefreshTokenRepository');
    expect(authService).not.toContain('RefreshTokenRepository');
    expect(userModule).not.toContain('UserRepository');
    expect(userService).not.toContain('UserRepository');
    expect(notificationService).not.toContain('UserRepository');
    expect(roleModule).not.toContain('RoleRepository');
    expect(roleService).not.toContain('RoleRepository');
    expect(permissionModule).not.toContain('PermissionRepository');
    expect(permissionModule).not.toContain('RoleEntity');
    expect(permissionService).not.toContain('PermissionRepository');
    expect(existsInSource('modules/api-auth/repositories/api-app.repository.ts')).toBe(false);
    expect(existsInSource('modules/api-auth/repositories/api-key.repository.ts')).toBe(false);
    expect(existsInSource('modules/auth/repositories/refresh-token.repository.ts')).toBe(false);
    expect(existsInSource('modules/user/repositories/user.repository.ts')).toBe(false);
    expect(existsInSource('modules/role/repositories/role.repository.ts')).toBe(false);
    expect(existsInSource('modules/permission/repositories/permission.repository.ts')).toBe(false);
  });

  it('keeps Docker deployment migration-based without init.sql or obsolete compose syntax', () => {
    const compose = readProject('docker-compose.yml');
    const testCompose = readProject('docker-compose.test.yml');
    const dockerfile = readProject('Dockerfile');

    expect(compose).not.toContain("version: '3.8'");
    expect(testCompose).not.toContain("version: '3.8'");
    expect(compose).not.toContain('init.sql');
    expect(dockerfile).toContain('pnpm run migration:run');
    expect(dockerfile).toContain('node dist/main');
  });

  it('uses configured file upload size at the multer layer', () => {
    const fileModule = readSource('modules/file/file.module.ts');
    const fileController = readSource('modules/file/controllers/file.controller.ts');

    expect(fileModule).toContain('MulterModule.registerAsync');
    expect(fileModule).toContain("configService.get<number>('file.maxSize'");
    expect(fileController).toContain("FileInterceptor('file')");
    expect(fileController).not.toContain('DEFAULT_FILE_MAX_SIZE');
    expect(fileController).not.toContain('limits:');
  });

  it('removes stale redis captcha excel and removed file-processing env examples', () => {
    const envTest = readProject('.env.test');
    const envExample = readProject('.env.example');

    for (const content of [envTest, envExample]) {
      expect(content).not.toMatch(/REDIS_|Redis|CAPTCHA|captcha/);
      expect(content).not.toMatch(/DB_SYNCHRONIZE|DB_ACQUIRE_TIMEOUT|DB_QUERY_TIMEOUT/);
      expect(content).not.toMatch(/FILE_CHUNK|FILE_IMAGE/);
      expect(content).not.toMatch(/\.xls|\.xlsx/);
    }
  });

  it('keeps committed environment templates aligned', () => {
    expect(readEnvKeys('.env.test')).toEqual(readEnvKeys('.env.example'));
  });

  it('keeps public docs aligned with the current lightweight personal-admin scope', () => {
    const readme = readProject('README.md');
    const claude = readProject('CLAUDE.md');
    const apiAuthQuickstart = readProject('API_AUTH_QUICKSTART.md');
    const deploymentQuickstart = readProject('DEPLOYMENT_QUICKSTART.md');
    const changelog = readProject('CHANGELOG.md');

    for (const content of [readme, claude, apiAuthQuickstart, deploymentQuickstart, changelog]) {
      expect(content).not.toMatch(/chunked upload|分片上传|image compression|图片压缩/i);
      expect(content).not.toMatch(/Data Dictionary|数据字典|task logs|任务日志/i);
      expect(content).not.toMatch(/BullMQ|Bull|Queue|RabbitMQ|Kafka/);
      expect(content).not.toMatch(/OAuth|GraphQL|billing|计费|Slack/);
      expect(content).not.toMatch(/home Server|home-server/);
      expect(content).not.toContain('uploadBatch');
      expect(content).not.toContain('Controller → Service → Repository');
    }
  });

  it('keeps package and docs aligned with the personal admin project instead of starter metadata', () => {
    const packageJson = readProject('package.json');
    const readme = readProject('README.md');
    const claude = readProject('CLAUDE.md');

    expect(packageJson).not.toMatch(/starter|boilerplate|production-ready/);
    expect(readme).not.toContain('NestJS Starter Pro');
    expect(readme).not.toContain('production-ready');
    expect(readme).not.toMatch(/(^|\s)npm run test/);
    expect(readme).not.toMatch(/(^|\s)npm run build/);
    expect(claude).not.toMatch(/(^|\s)npm run test/);
    expect(claude).not.toMatch(/(^|\s)npm run build/);
  });

  it('keeps process memory cache API minimal for the current single-server design', () => {
    const cacheService = readSource('shared/cache/cache.service.ts');

    for (const method of ['getOrSet', 'mget', 'mset', 'keys', 'increment', 'decrement']) {
      expect(cacheService).not.toContain(`async ${method}(`);
    }

    expect(cacheService).not.toContain('LoggerService');
    expect(cacheService).not.toContain('constructor(');
  });

  it('removes cache invalidation calls that no longer have matching read paths', () => {
    const fileService = readSource('modules/file/services/file.service.ts');
    const notificationService = readSource('modules/notification/services/notification.service.ts');
    const permissionService = readSource('modules/permission/services/permission.service.ts');
    const menuService = readSource('modules/menu/services/menu.service.ts');
    const roleService = readSource('modules/role/services/role.service.ts');

    expect(fileService).not.toContain('clearFileCache');
    expect(notificationService).not.toContain('clearNotificationCache');
    expect(permissionService).not.toContain('clearPermissionCache');
    expect(menuService).not.toContain('clearMenuCache');
    expect(menuService).not.toContain('clearMenuRelatedCache');
    expect(roleService).not.toContain('clearRoleCache');
    expect(roleService).not.toContain('clearUserMenuCache');
    expect(roleService).toContain('clearUserPermissionCache');
  });

  it('keeps permission lookup in PermissionsGuard/UserService rather than JwtStrategy', () => {
    const jwtStrategy = readSource('modules/auth/strategies/jwt.strategy.ts');
    const permissionsGuard = readSource('core/guards/permissions.guard.ts');

    expect(jwtStrategy).not.toContain('getUserPermissions');
    expect(jwtStrategy).not.toContain('permissions:');
    expect(permissionsGuard).toContain('getUserPermissions');
    expect(permissionsGuard).not.toContain('clearUserPermissionsCache');
  });

  it('keeps family-facing user avatar responses on trusted access links', () => {
    const familyService = readSource('modules/family/services/family.service.ts');
    const babyService = readSource('modules/family/services/baby.service.ts');

    for (const content of [familyService, babyService]) {
      expect(content).not.toContain('avatar: user.avatar');
      expect(content).toContain('resolveTrustedAvatarUrl');
    }
  });

  it('removes unused crypto helpers, duplicate multer ambient types, and unused permission service reads', () => {
    const cryptoUtil = readSource('common/utils/crypto.util.ts');
    const permissionService = readSource('modules/permission/services/permission.service.ts');
    const fileService = readSource('modules/file/services/file.service.ts');

    expect(cryptoUtil).toContain('hashPassword');
    expect(cryptoUtil).toContain('comparePassword');
    for (const token of [
      'generateRandomString',
      'generateRandomNumbers',
      'static md5',
      'static sha256',
      'base64Encode',
      'base64Decode',
    ]) {
      expect(cryptoUtil).not.toContain(token);
    }

    expect(permissionService).not.toContain('async findByModule');
    expect(permissionService).not.toContain('async findByIds');
    expect(fileService).not.toContain('ensureDirectories');
    expect(fileService).not.toContain('uploadRoot');
    expect(existsInSource('types/express.d.ts')).toBe(false);
  });
});
