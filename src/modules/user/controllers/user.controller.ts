import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { UserService } from '../services/user.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { UpdateUserNotificationSettingsDto } from '../dto/update-user-notification-settings.dto';
import { QueryUserDto } from '../dto/query-user.dto';
import { ChangePasswordDto, ResetPasswordDto } from '../dto/change-password.dto';
import { DeleteUsersDto } from '../dto/delete-users.dto';
import { AssignUserRolesDto } from '../dto/assign-user-roles.dto';
import { RequirePermissions, AllowAuthenticated } from '~/core/decorators';
import { UserEntity } from '../entities/user.entity';
import { CurrentUser } from '~/modules/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '~/modules/auth/strategies/jwt.strategy';
import { MessageResponseDto } from '~/common/dto/message-response.dto';
import { UserPermissionsResponseDto } from '../dto/user-permissions-response.dto';

@ApiTags('用户管理')
@ApiBearerAuth()
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @RequirePermissions('user:create')
  @ApiOperation({ summary: '创建用户' })
  @ApiCreatedResponse({ type: UserEntity })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  async create(@Body() dto: CreateUserDto) {
    return this.userService.createUser(dto);
  }

  @Get()
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '获取用户列表' })
  @ApiOkResponse({ description: '获取用户列表成功' })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  async findAll(@Query() query: QueryUserDto) {
    return this.userService.findUsers(query);
  }

  // 注意：具体路径必须在参数化路径之前定义，否则会被 :id 匹配
  @Get('profile')
  @AllowAuthenticated()
  @ApiOperation({ summary: '获取当前用户信息' })
  @ApiOkResponse({ type: UserEntity })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  @ApiNotFoundResponse({ description: '请求的资源不存在' })
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.userService.findUserProfileById(user.id);
  }

  @Put('profile')
  @AllowAuthenticated()
  @ApiOperation({ summary: '更新当前用户信息' })
  @ApiOkResponse({ type: UserEntity })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  @ApiNotFoundResponse({ description: '请求的资源不存在' })
  async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.userService.withTrustedAvatarUrl(
      await this.userService.updateUser(user.id, dto, user),
    );
  }

  @Put('password')
  @AllowAuthenticated()
  @ApiOperation({ summary: '修改密码' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  async changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    await this.userService.changePassword(user.id, dto);
    return MessageResponseDto.of('密码修改成功');
  }

  @Delete('batch')
  @RequirePermissions('user:delete')
  @ApiOperation({ summary: '批量删除用户' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  async removeMany(@Body() dto: DeleteUsersDto, @CurrentUser() user: AuthenticatedUser) {
    await this.userService.deleteUsers(dto.ids, user);
    return MessageResponseDto.of('批量删除成功');
  }

  @Get(':id/notification-settings')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '获取用户通知绑定配置' })
  @ApiParam({ name: 'id', description: '用户ID' })
  @ApiOkResponse({ description: '获取用户通知绑定配置成功' })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  @ApiNotFoundResponse({ description: '请求的资源不存在' })
  async getNotificationSettings(@Param('id', ParseIntPipe) id: number) {
    return this.userService.getNotificationSettings(id);
  }

  @Put(':id/notification-settings')
  @RequirePermissions('user:update')
  @ApiOperation({ summary: '更新用户通知绑定配置' })
  @ApiParam({ name: 'id', description: '用户ID' })
  @ApiOkResponse({ description: '更新用户通知绑定配置成功' })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  @ApiNotFoundResponse({ description: '请求的资源不存在' })
  async updateNotificationSettings(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserNotificationSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userService.updateNotificationSettings(id, dto, user);
  }

  @Get(':id')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '获取用户详情' })
  @ApiParam({ name: 'id', description: '用户ID' })
  @ApiOkResponse({ type: UserEntity })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  @ApiNotFoundResponse({ description: '请求的资源不存在' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findUserById(id);
  }

  @Put(':id')
  @RequirePermissions('user:update')
  @ApiOperation({ summary: '更新用户' })
  @ApiParam({ name: 'id', description: '用户ID' })
  @ApiOkResponse({ type: UserEntity })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  @ApiNotFoundResponse({ description: '请求的资源不存在' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userService.updateUser(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('user:delete')
  @ApiOperation({ summary: '删除用户' })
  @ApiParam({ name: 'id', description: '用户ID' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  @ApiNotFoundResponse({ description: '请求的资源不存在' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    await this.userService.deleteUser(id, user);
    return MessageResponseDto.of('删除成功');
  }

  @Put(':id/password/reset')
  @RequirePermissions('user:password:reset')
  @ApiOperation({ summary: '重置用户密码（管理员）' })
  @ApiParam({ name: 'id', description: '用户ID' })
  @ApiOkResponse({ type: MessageResponseDto })
  async resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.userService.resetPassword(id, dto, user);
    return MessageResponseDto.of('密码重置成功');
  }

  @Put(':id/enable')
  @RequirePermissions('user:update')
  @ApiOperation({ summary: '启用用户' })
  @ApiParam({ name: 'id', description: '用户ID' })
  @ApiOkResponse({ type: UserEntity })
  async enable(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.userService.enableUser(id, user);
  }

  @Put(':id/disable')
  @RequirePermissions('user:update')
  @ApiOperation({ summary: '禁用用户' })
  @ApiParam({ name: 'id', description: '用户ID' })
  @ApiOkResponse({ type: UserEntity })
  async disable(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.userService.disableUser(id, user);
  }

  @Put(':id/roles')
  @RequirePermissions('role:assign')
  @ApiOperation({ summary: '分配角色' })
  @ApiParam({ name: 'id', description: '用户ID' })
  @ApiOkResponse({ type: UserEntity })
  async assignRoles(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignUserRolesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userService.assignRoles(id, dto.roleIds, user);
  }

  @Get(':id/permissions')
  @RequirePermissions('permission:read')
  @ApiOperation({ summary: '获取用户权限' })
  @ApiParam({ name: 'id', description: '用户ID' })
  @ApiOkResponse({ type: UserPermissionsResponseDto })
  async getPermissions(@Param('id', ParseIntPipe) id: number) {
    const permissions = await this.userService.getUserPermissions(id);
    return UserPermissionsResponseDto.of(permissions);
  }
}
