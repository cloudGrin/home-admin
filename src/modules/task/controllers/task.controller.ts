import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RequirePermissions } from '~/core/decorators';
import { CurrentUser } from '~/modules/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '~/modules/auth/strategies/jwt.strategy';
import { CreateFileAccessLinkDto } from '~/modules/file/dto/file-access-link.dto';
import { CreateTaskDto, QueryTaskDto, SnoozeTaskReminderDto, UpdateTaskDto } from '../dto';
import { TaskService } from '../services/task.service';

@ApiTags('任务管理')
@ApiBearerAuth()
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '获取任务列表' })
  async findTasks(@Query() query: QueryTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.taskService.findTasks(query, user);
  }

  @Post()
  @RequirePermissions('task:create')
  @ApiOperation({ summary: '创建任务' })
  async createTask(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.taskService.createTask(dto, user);
  }

  @Get('assignees')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '获取任务负责人候选人' })
  async findAssignees() {
    return this.taskService.findAssigneeOptions();
  }

  @Get(':id')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '获取任务详情' })
  async findTask(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.taskService.findTask(id, user);
  }

  @Put(':id')
  @RequirePermissions('task:update')
  @ApiOperation({ summary: '更新任务' })
  async updateTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskService.updateTask(id, dto, user);
  }

  @Patch(':id/complete')
  @RequirePermissions('task:complete')
  @ApiOperation({ summary: '完成任务' })
  async completeTask(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskService.completeTask(id, user.id, user);
  }

  @Patch(':id/reopen')
  @RequirePermissions('task:update')
  @ApiOperation({ summary: '重新打开任务' })
  async reopenTask(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.taskService.reopenTask(id, user);
  }

  @Post(':id/reminder/snooze')
  @RequirePermissions('task:update')
  @ApiOperation({ summary: '稍后提醒任务' })
  async snoozeTaskReminder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SnoozeTaskReminderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskService.snoozeTaskReminder(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('task:delete')
  @ApiOperation({ summary: '删除任务' })
  async removeTask(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    await this.taskService.removeTask(id, user);
  }

  @Get(':id/attachments/:fileId/download')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '下载任务附件' })
  async downloadAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.taskService.getAttachmentDownload(id, fileId, user);
    if (result.redirectUrl) {
      res.redirect(302, result.redirectUrl);
      return;
    }

    res.setHeader('Content-Type', result.file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(result.file.originalName)}`,
    );

    return new StreamableFile(result.stream as any);
  }

  @Post(':id/attachments/:fileId/access-link')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '创建任务附件临时访问链接' })
  async createAttachmentAccessLink(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Body() dto: CreateFileAccessLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskService.createAttachmentAccessLink(id, fileId, user, dto);
  }
}
