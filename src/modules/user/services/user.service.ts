import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { LoggerService } from '~/shared/logger/logger.service';
import { CacheService } from '~/shared/cache/cache.service';
import { PaginationResult } from '~/common/types/pagination.types';
import { RefreshTokenEntity } from '~/modules/auth/entities/refresh-token.entity';
import { UserNotificationSettingEntity } from '~/modules/notification/entities/user-notification-setting.entity';
import { FileService } from '~/modules/file/services/file.service';
import { UserEntity } from '../entities/user.entity';
import { RoleEntity } from '~/modules/role/entities/role.entity';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UpdateUserNotificationSettingsDto } from '../dto/update-user-notification-settings.dto';
import { QueryUserDto } from '../dto/query-user.dto';
import { ChangePasswordDto, ResetPasswordDto } from '../dto/change-password.dto';
import { UserStatus } from '~/common/enums/user.enum';

const USER_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'username', 'email', 'lastLoginAt']);
const USER_PERMISSION_CACHE_TTL_SECONDS = 1800;
const USER_AVATAR_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const userPermissionsCacheKey = (userId: number) => `user:permissions:${userId}`;
const SUPER_ADMIN_ROLE_CODE = 'super_admin';

interface UserActionActor {
  id: number;
  isSuperAdmin?: boolean;
  roleCode?: string;
  roles?: string[];
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
    @InjectRepository(UserNotificationSettingEntity)
    private readonly notificationSettingRepository: Repository<UserNotificationSettingEntity>,
    private readonly logger: LoggerService,
    private readonly cache: CacheService,
    private readonly fileService: FileService,
  ) {}

  /**
   * 创建用户
   */
  async createUser(dto: CreateUserDto): Promise<UserEntity> {
    this.logger.debug(`准备创建用户 username=${dto.username}, email=${dto.email}`);

    // 检查用户名是否存在
    if (await this.isUsernameExist(dto.username)) {
      this.logger.debug(`创建用户失败，用户名已存在 username=${dto.username}`);
      throw new ConflictException('用户名已存在');
    }

    // 检查邮箱是否存在
    if (await this.isEmailExist(dto.email)) {
      this.logger.debug(`创建用户失败，邮箱已存在 email=${dto.email}`);
      throw new ConflictException('邮箱已被注册');
    }

    // 检查手机号是否存在
    if (dto.phone && (await this.isPhoneExist(dto.phone))) {
      this.logger.debug(`创建用户失败，手机号已存在 phone=${dto.phone}`);
      throw new ConflictException('手机号已被注册');
    }

    const { roleIds: _ignoredRoleIds, ...userData } = dto as CreateUserDto & {
      roleIds?: number[];
    };

    // 创建用户
    const user = this.userRepository.create({
      ...userData,
      roles: [],
    });

    const savedUser = await this.userRepository.save(user);
    this.logger.debug(`用户保存成功 id=${savedUser.id}, username=${savedUser.username}`);

    this.logger.log(`Created user: ${savedUser.username} (ID: ${savedUser.id})`);

    // 排除敏感字段password
    const { password: _password, ...userWithoutPassword } = savedUser;

    return userWithoutPassword as UserEntity;
  }

  async getNotificationSettings(userId: number): Promise<UserNotificationSettingEntity> {
    await this.findByIdWithRolesOrFail(userId);

    const setting = await this.notificationSettingRepository.findOne({
      where: { userId },
    });

    return setting ?? this.createDefaultNotificationSettings(userId);
  }

  async updateNotificationSettings(
    userId: number,
    dto: UpdateUserNotificationSettingsDto,
    actor?: UserActionActor,
  ): Promise<UserNotificationSettingEntity> {
    const user = await this.findByIdWithRolesOrFail(userId);
    this.ensureCanMutateSuperAdminTarget(user, actor, '修改超级管理员通知绑定');

    const existing = await this.notificationSettingRepository.findOne({
      where: { userId },
    });
    const next = {
      userId,
      barkKey: this.normalizeOptionalText(
        this.getPatchValue(dto, 'barkKey', existing?.barkKey ?? null),
      ),
      feishuUserId: this.normalizeOptionalText(
        this.getPatchValue(dto, 'feishuUserId', existing?.feishuUserId ?? null),
      ),
    };

    const entity = existing
      ? Object.assign(existing, next)
      : this.notificationSettingRepository.create(next);

    return this.notificationSettingRepository.save(entity);
  }

  /**
   * 更新用户
   */
  async updateUser(id: number, dto: UpdateUserDto, actor?: UserActionActor): Promise<UserEntity> {
    this.logger.debug(`准备更新用户 id=${id}, payload=${JSON.stringify(dto)}`);

    const user = await this.findByIdWithRolesOrFail(id);
    this.logger.debug(`更新用户时找到用户 id=${id}, username=${user.username}`);

    this.ensureCanMutateSuperAdminTarget(user, actor, '修改超级管理员');
    const previousStatus = user.status;

    // 检查邮箱是否存在
    if (dto.email && dto.email !== user.email) {
      if (await this.isEmailExist(dto.email, id)) {
        this.logger.debug(`更新用户失败，邮箱已存在 id=${id}, email=${dto.email}`);
        throw new ConflictException('邮箱已被注册');
      }
    }

    // 检查手机号是否存在
    if (dto.phone && dto.phone !== user.phone) {
      if (await this.isPhoneExist(dto.phone, id)) {
        this.logger.debug(`更新用户失败，手机号已存在 id=${id}, phone=${dto.phone}`);
        throw new ConflictException('手机号已被注册');
      }
    }

    if (dto.status && dto.status !== user.status && this.isSuperAdminUser(user)) {
      await this.ensureNotLastActiveSuperAdmin(user, dto.status);
    }

    const { roleIds: _ignoredRoleIds, ...userData } = dto as UpdateUserDto & {
      roleIds?: number[];
    };

    // 更新用户信息
    Object.assign(user, userData);
    this.logger.debug(`用户信息合并完成，准备保存 id=${id}`);
    const updatedUser = await this.userRepository.save(user);
    this.logger.debug(`用户更新保存成功 id=${updatedUser.id}`);

    if (dto.status && dto.status !== previousStatus && dto.status !== UserStatus.ACTIVE) {
      await this.revokeRefreshTokens(id);
      this.logger.debug(`用户状态变更为非活跃后清除令牌 userId=${id}, status=${dto.status}`);
    }

    this.logger.log(`Updated user: ${updatedUser.username} (ID: ${updatedUser.id})`);

    return updatedUser;
  }

  /**
   * 查询用户列表
   */
  async findUsers(query: QueryUserDto): Promise<PaginationResult<UserEntity>> {
    this.logger.debug(`查询用户列表，过滤条件=${JSON.stringify(query)}`);
    const [items, totalItems] = await this.findWithQuery(query);
    this.logger.debug(`查询用户列表完成，返回数量=${items.length}, 总数=${totalItems}`);

    return {
      items,
      meta: {
        totalItems,
        itemCount: items.length,
        itemsPerPage: query.limit || 10,
        totalPages: Math.ceil(totalItems / (query.limit || 10)),
        currentPage: query.page || 1,
      },
    };
  }

  /**
   * 获取用户详情
   */
  async findUserById(id: number): Promise<UserEntity> {
    this.logger.debug(`查询用户详情 id=${id}`);

    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['roles', 'roles.permissions'],
    });

    if (!user) {
      this.logger.debug(`查询用户详情失败，未找到用户 id=${id}`);
      throw new NotFoundException('用户不存在');
    }

    this.logger.debug(
      `[UserService.findUserById] TypeORM查询用户详情: userId=${id}, username=${user.username}, rolesCount=${user.roles?.length || 0}, roleCodes=${JSON.stringify(user.roles?.map((r) => r.code) || [])}`,
    );

    (user as UserEntity & { permissions?: string[] }).permissions =
      this.collectActivePermissionCodes(user);

    return user;
  }

  async findUserProfileById(id: number): Promise<UserEntity> {
    return this.withTrustedAvatarUrl(await this.findUserById(id));
  }

  async withTrustedAvatarUrl<T extends { avatar?: string | null }>(user: T): Promise<T> {
    const avatar = await this.resolveTrustedAvatarUrl(user.avatar);
    if (avatar === user.avatar) {
      return user;
    }

    return {
      ...user,
      avatar,
    } as T;
  }

  async resolveTrustedAvatarUrl(avatar?: string | null): Promise<string | null | undefined> {
    const fileId = this.extractAvatarFileId(avatar);
    if (!fileId) {
      return avatar;
    }

    const link = await this.fileService.createTrustedAccessLink(fileId, {
      disposition: 'inline',
      cacheMaxAgeSeconds: USER_AVATAR_CACHE_MAX_AGE_SECONDS,
    });

    return link.url;
  }

  /**
   * 根据用户名获取用户
   */
  async findByUsername(username: string): Promise<UserEntity | null> {
    this.logger.debug(`根据用户名查询用户 username=${username}`);
    const result = await this.userRepository.findOne({
      where: { username },
      relations: ['roles'],
    });
    this.logger.debug(`根据用户名查询用户结果 username=${username}, exists=${result ? 'Y' : 'N'}`);
    return result;
  }

  /**
   * 根据邮箱获取用户
   */
  async findByEmail(email: string): Promise<UserEntity | null> {
    this.logger.debug(`根据邮箱查询用户 email=${email}`);
    const result = await this.userRepository.findOne({
      where: { email },
      relations: ['roles'],
    });
    this.logger.debug(`根据邮箱查询用户结果 email=${email}, exists=${result ? 'Y' : 'N'}`);
    return result;
  }

  /**
   * 修改密码
   */
  async changePassword(userId: number, dto: ChangePasswordDto): Promise<void> {
    this.logger.debug(`用户修改密码 userId=${userId}`);

    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('两次输入的密码不一致');
    }

    const user = await this.findWithPassword(userId);
    if (!user) {
      this.logger.debug(`修改密码失败，未找到用户 userId=${userId}`);
      throw new NotFoundException('用户不存在');
    }

    // 验证旧密码
    const isValidPassword = await user.validatePassword(dto.oldPassword);
    if (!isValidPassword) {
      this.logger.debug(`修改密码失败，旧密码验证未通过 userId=${userId}`);
      throw new BadRequestException('当前密码错误');
    }

    // 更新密码
    user.password = dto.newPassword;
    await this.userRepository.save(user);
    this.logger.debug(`用户密码更新成功 userId=${userId}`);

    // 清除用户的刷新Token（强制重新登录）
    await this.revokeRefreshTokens(userId);
    this.logger.debug(`清除用户刷新Token userId=${userId}`);

    this.logger.log(`User ${userId} changed password`);
  }

  /**
   * 重置密码（管理员操作）
   */
  async resetPassword(
    userId: number,
    dto: ResetPasswordDto,
    actor?: UserActionActor,
  ): Promise<void> {
    this.logger.debug(`管理员重置密码 userId=${userId}`);

    const user = await this.findByIdWithRolesOrFail(userId);
    this.ensureCanMutateSuperAdminTarget(user, actor, '重置超级管理员密码');

    // 更新密码
    user.password = dto.password;
    user.loginAttempts = 0;
    user.lockedUntil = null;
    await this.userRepository.save(user);
    this.logger.debug(`用户密码重置保存成功 userId=${userId}`);

    // 清除用户的刷新Token（强制重新登录）
    await this.revokeRefreshTokens(userId);
    this.logger.debug(`重置密码后清除刷新Token userId=${userId}`);

    this.logger.log(`Reset password for user ${userId}`);
  }

  /**
   * 启用用户
   */
  async enableUser(id: number, actor?: UserActionActor): Promise<UserEntity> {
    this.logger.debug(`启用用户 id=${id}`);

    const user = await this.findByIdWithRolesOrFail(id);
    this.ensureCanMutateSuperAdminTarget(user, actor, '启用超级管理员');

    user.status = UserStatus.ACTIVE;
    user.loginAttempts = 0;
    user.lockedUntil = null;

    const updatedUser = await this.userRepository.save(user);
    this.logger.debug(`用户启用保存成功 id=${id}`);

    this.logger.log(`Enabled user: ${updatedUser.username} (ID: ${id})`);

    return updatedUser;
  }

  /**
   * 禁用用户
   */
  async disableUser(id: number, actor?: UserActionActor): Promise<UserEntity> {
    this.logger.debug(`禁用用户 id=${id}`);

    const user = await this.findByIdWithRolesOrFail(id);
    this.ensureCanMutateSuperAdminTarget(user, actor, '禁用超级管理员');
    await this.ensureNotLastActiveSuperAdmin(user, UserStatus.DISABLED);

    user.status = UserStatus.DISABLED;

    const updatedUser = await this.userRepository.save(user);
    this.logger.debug(`用户禁用保存成功 id=${id}`);

    // 清除用户的刷新Token（强制下线）
    await this.revokeRefreshTokens(id);
    this.logger.debug(`禁用用户后清除刷新Token userId=${id}`);

    this.logger.log(`Disabled user: ${updatedUser.username} (ID: ${id})`);

    return updatedUser;
  }

  /**
   * 删除用户
   */
  async deleteUser(id: number, actor?: UserActionActor): Promise<void> {
    this.logger.debug(`删除用户 id=${id}`);

    const user = await this.findByIdWithRolesOrFail(id);
    this.ensureCanMutateSuperAdminTarget(user, actor, '删除超级管理员');
    await this.ensureNotLastActiveSuperAdmin(user, undefined);

    await this.userRepository.softDelete(id);
    await this.notificationSettingRepository.delete({ userId: id });
    await this.revokeRefreshTokens(id);
    this.logger.debug(`用户软删除完成 id=${id}`);

    this.logger.log(`Deleted user: ${user.username} (ID: ${id})`);
  }

  /**
   * 批量删除用户
   */
  async deleteUsers(ids: number[], actor?: UserActionActor): Promise<void> {
    this.logger.debug(`批量删除用户 ids=${JSON.stringify(ids)}`);

    const users = await this.findByIds(ids);

    if (users.length !== ids.length) {
      this.logger.debug(
        `批量删除用户失败，部分用户不存在 请求数量=${ids.length}, 实际数量=${users.length}`,
      );
      throw new BadRequestException('部分用户不存在');
    }

    for (const user of users) {
      this.ensureCanMutateSuperAdminTarget(user, actor, '删除超级管理员');
    }
    await this.ensureBatchDoesNotRemoveLastActiveSuperAdmin(users);

    for (const user of users) {
      await this.userRepository.softDelete(user.id);
      await this.notificationSettingRepository.delete({ userId: user.id });
      await this.revokeRefreshTokens(user.id);
      this.logger.debug(`用户软删除完成 id=${user.id}`);
    }

    this.logger.log(`Batch deleted ${users.length} users`);
  }

  /**
   * 分配角色
   */
  async assignRoles(
    userId: number,
    roleIds: number[],
    actor?: UserActionActor,
  ): Promise<UserEntity> {
    this.logger.debug(`分配角色 userId=${userId}, roleIds=${JSON.stringify(roleIds)}`);

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['roles'],
    });

    if (!user) {
      this.logger.debug(`分配角色失败，未找到用户 userId=${userId}`);
      throw new NotFoundException('用户不存在');
    }

    const roles =
      roleIds.length === 0
        ? []
        : await this.roleRepository.find({
            where: { id: In(roleIds), isActive: true },
          });

    this.logger.debug(
      `分配角色查询结果 userId=${userId}, 请求数量=${roleIds.length}, 查询数量=${roles.length}`,
    );

    if (roles.length !== roleIds.length) {
      this.logger.debug(`分配角色失败，部分角色不存在或禁用 userId=${userId}`);
      throw new BadRequestException('部分角色不存在或已禁用');
    }

    const currentlySuperAdmin = this.isSuperAdminUser(user);
    const nextSuperAdmin = roles.some((role) => role.code === SUPER_ADMIN_ROLE_CODE);

    if (currentlySuperAdmin || nextSuperAdmin) {
      this.ensureActorIsSuperAdmin(actor, '只有超级管理员可以分配或移除 super_admin 角色');
    }

    if (currentlySuperAdmin && !nextSuperAdmin) {
      await this.ensureNotLastActiveSuperAdmin(user, undefined);
    }

    user.roles = roles;
    const updatedUser = await this.userRepository.save(user);
    this.logger.debug(`分配角色保存成功 userId=${userId}`);

    // 清除权限缓存，确保角色变更后权限立即生效
    await this.clearUserPermissionCache(userId);

    this.logger.log(`Assigned ${roles.length} roles to user ${userId}`);

    return updatedUser;
  }

  /**
   * 获取用户权限
   */
  async getUserPermissions(userId: number): Promise<string[]> {
    this.logger.debug(`获取用户权限 userId=${userId}`);
    const cacheKey = userPermissionsCacheKey(userId);

    // 尝试从缓存获取
    const cached = await this.cache.get<string[]>(cacheKey);
    if (cached) {
      this.logger.debug(`用户权限缓存命中 userId=${userId}, 权限数量=${cached.length}`);
      return cached;
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['roles', 'roles.permissions'],
    });

    if (!user) {
      this.logger.debug(`获取用户权限失败，未找到用户 userId=${userId}`);
      return [];
    }

    if (user.roles?.some((role) => role.isActive && role.code === 'super_admin')) {
      const permissions = ['*'];
      await this.cache.set(cacheKey, permissions, USER_PERMISSION_CACHE_TTL_SECONDS);
      this.logger.debug(`超级管理员权限计算完成 userId=${userId}, 权限=*`);
      return permissions;
    }

    // 收集所有权限编码
    const permissions = new Set<string>();
    for (const role of user.roles) {
      if (role.isActive) {
        this.logger.debug(
          `收集角色权限 userId=${userId}, roleId=${role.id}, permissionCount=${role.permissions?.length || 0}`,
        );
        for (const permission of role.permissions) {
          if (permission.isActive) {
            permissions.add(permission.code);
          }
        }
      }
    }

    const permissionList = Array.from(permissions);
    this.logger.debug(`计算用户权限完成 userId=${userId}, 权限数量=${permissionList.length}`);

    await this.cache.set(cacheKey, permissionList, USER_PERMISSION_CACHE_TTL_SECONDS);
    this.logger.debug(
      `用户权限写入缓存 userId=${userId}, ttl=${USER_PERMISSION_CACHE_TTL_SECONDS}`,
    );

    return permissionList;
  }

  /**
   * 清除用户权限缓存
   * 注意：这会清除PermissionsGuard中缓存的用户权限，确保角色变更后立即生效
   */
  private async clearUserPermissionCache(userId: number): Promise<void> {
    const cacheKey = userPermissionsCacheKey(userId);
    await this.cache.del(cacheKey);
    this.logger.debug(`已清除用户权限缓存 userId=${userId}`);
  }

  private async isUsernameExist(username: string, excludeId?: number): Promise<boolean> {
    const qb = this.userRepository
      .createQueryBuilder('user')
      .withDeleted()
      .where('user.username = :username', {
        username,
      });

    if (excludeId) {
      qb.andWhere('user.id != :id', { id: excludeId });
    }

    return (await qb.getCount()) > 0;
  }

  private async isEmailExist(email: string, excludeId?: number): Promise<boolean> {
    const qb = this.userRepository
      .createQueryBuilder('user')
      .withDeleted()
      .where('user.email = :email', {
        email,
      });

    if (excludeId) {
      qb.andWhere('user.id != :id', { id: excludeId });
    }

    return (await qb.getCount()) > 0;
  }

  private async isPhoneExist(phone: string, excludeId?: number): Promise<boolean> {
    const qb = this.userRepository
      .createQueryBuilder('user')
      .withDeleted()
      .where('user.phone = :phone', {
        phone,
      });

    if (excludeId) {
      qb.andWhere('user.id != :id', { id: excludeId });
    }

    return (await qb.getCount()) > 0;
  }

  private async findByIdWithRolesOrFail(id: number): Promise<UserEntity> {
    const entity = await this.userRepository.findOne({
      where: { id } as FindOptionsWhere<UserEntity>,
      relations: ['roles'],
    });

    if (!entity) {
      throw new NotFoundException('用户不存在');
    }

    return entity;
  }

  private isSuperAdminUser(user: UserEntity): boolean {
    return user.roles?.some((role) => role.code === SUPER_ADMIN_ROLE_CODE) ?? false;
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

  private isActorSuperAdmin(actor?: UserActionActor): boolean {
    return (
      actor?.isSuperAdmin === true ||
      actor?.roleCode === SUPER_ADMIN_ROLE_CODE ||
      actor?.roles?.includes(SUPER_ADMIN_ROLE_CODE) === true
    );
  }

  private ensureActorIsSuperAdmin(actor: UserActionActor | undefined, message: string): void {
    if (!this.isActorSuperAdmin(actor)) {
      throw new ForbiddenException(message);
    }
  }

  private ensureCanMutateSuperAdminTarget(
    target: UserEntity,
    actor: UserActionActor | undefined,
    action: string,
  ): void {
    if (!this.isSuperAdminUser(target)) {
      return;
    }

    this.ensureActorIsSuperAdmin(actor, `只有超级管理员可以${action}`);
  }

  private async ensureNotLastActiveSuperAdmin(
    user: UserEntity,
    nextStatus: UserStatus | undefined,
  ): Promise<void> {
    if (!this.isSuperAdminUser(user) || user.status !== UserStatus.ACTIVE) {
      return;
    }

    if (nextStatus === UserStatus.ACTIVE) {
      return;
    }

    const activeSuperAdminCount = await this.countActiveSuperAdmins();
    if (activeSuperAdminCount <= 1) {
      throw new BadRequestException('至少需要保留一个可用的超级管理员');
    }
  }

  private async ensureBatchDoesNotRemoveLastActiveSuperAdmin(users: UserEntity[]): Promise<void> {
    const removingActiveSuperAdminIds = new Set(
      users
        .filter((user) => user.status === UserStatus.ACTIVE && this.isSuperAdminUser(user))
        .map((user) => user.id),
    );

    if (removingActiveSuperAdminIds.size === 0) {
      return;
    }

    const activeSuperAdminCount = await this.countActiveSuperAdmins();
    if (activeSuperAdminCount - removingActiveSuperAdminIds.size < 1) {
      throw new BadRequestException('至少需要保留一个可用的超级管理员');
    }
  }

  private async countActiveSuperAdmins(): Promise<number> {
    return this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.roles', 'role')
      .where('user.status = :status', { status: UserStatus.ACTIVE })
      .andWhere('role.code = :roleCode', { roleCode: SUPER_ADMIN_ROLE_CODE })
      .andWhere('role.isActive = :roleActive', { roleActive: true })
      .getCount();
  }

  private async findWithPassword(id: number): Promise<UserEntity | null> {
    return this.userRepository.findOne({
      where: { id },
      select: ['id', 'username', 'email', 'password', 'status', 'loginAttempts', 'lockedUntil'],
      relations: ['roles'],
    });
  }

  private async findWithQuery(query: QueryUserDto): Promise<[UserEntity[], number]> {
    const {
      username,
      email,
      phone,
      realName,
      status,
      gender,
      roleId,
      page = 1,
      limit = 10,
      sort,
      order,
    } = query;

    const qb = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'role');

    if (username) {
      qb.andWhere('user.username LIKE :username', { username: `%${username}%` });
    }

    if (email) {
      qb.andWhere('user.email LIKE :email', { email: `%${email}%` });
    }

    if (phone) {
      qb.andWhere('user.phone LIKE :phone', { phone: `%${phone}%` });
    }

    if (realName) {
      qb.andWhere('user.realName LIKE :realName', { realName: `%${realName}%` });
    }

    if (status) {
      qb.andWhere('user.status = :status', { status });
    }

    if (gender) {
      qb.andWhere('user.gender = :gender', { gender });
    }

    if (roleId) {
      qb.innerJoin('user.roles', 'filterRole', 'filterRole.id = :roleId', { roleId });
    }

    if (sort && USER_SORT_FIELDS.has(sort)) {
      qb.orderBy(`user.${sort}`, order || 'ASC');
    } else {
      qb.orderBy('user.createdAt', 'DESC');
    }

    qb.skip((page - 1) * limit).take(limit);

    return qb.getManyAndCount();
  }

  private async findByIds(ids: number[]): Promise<UserEntity[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.userRepository.find({
      where: { id: In(ids) },
      relations: ['roles'],
    });
  }

  private async revokeRefreshTokens(userId: number): Promise<void> {
    await this.refreshTokenRepository.update({ userId, isRevoked: false }, { isRevoked: true });
    await this.revokeAllAccessTokens(userId);
  }

  private async revokeAllAccessTokens(userId: number): Promise<void> {
    await this.userRepository.increment({ id: userId }, 'tokenVersion', 1);
  }

  private createDefaultNotificationSettings(userId: number): UserNotificationSettingEntity {
    return Object.assign(new UserNotificationSettingEntity(), {
      userId,
      barkKey: null,
      feishuUserId: null,
    });
  }

  private extractAvatarFileId(avatar?: string | null): number | undefined {
    if (!avatar) {
      return undefined;
    }

    const value = avatar.trim();
    if (!value.startsWith('/')) {
      return undefined;
    }

    const match = value.match(/\/files\/(\d+)\/(?:public|access)(?:[/?#]|$)/);
    if (!match) {
      return undefined;
    }

    const fileId = Number(match[1]);
    return Number.isSafeInteger(fileId) && fileId > 0 ? fileId : undefined;
  }

  private normalizeOptionalText(value?: string | null): string | null {
    const text = value?.trim();
    return text ? text : null;
  }

  private getPatchValue<T extends keyof UpdateUserNotificationSettingsDto>(
    dto: UpdateUserNotificationSettingsDto,
    key: T,
    fallback: UpdateUserNotificationSettingsDto[T],
  ): UpdateUserNotificationSettingsDto[T] {
    return Object.prototype.hasOwnProperty.call(dto, key) ? dto[key] : fallback;
  }
}
