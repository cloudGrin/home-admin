import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '~/core/decorators';
import { AuthenticatedUser } from '~/modules/auth/strategies/jwt.strategy';
import {
  DeleteFileCleanupCandidatesDto,
  IgnoreFileCleanupCandidatesDto,
  QueryFileCleanupCandidatesDto,
  ScanFileCleanupCandidatesDto,
} from '../dto/file-cleanup.dto';
import { FileCleanupService } from '../services/file-cleanup.service';

@ApiTags('文件清理')
@ApiBearerAuth()
@Controller('file-cleanup/candidates')
export class FileCleanupController {
  constructor(private readonly cleanupService: FileCleanupService) {}

  @Get()
  @RequirePermissions('file:read')
  @ApiOperation({ summary: '获取文件清理候选列表' })
  @ApiOkResponse({ description: '获取文件清理候选列表成功' })
  async findCandidates(@Query() query: QueryFileCleanupCandidatesDto) {
    return this.cleanupService.findCandidates(query);
  }

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('file:read')
  @ApiOperation({ summary: '扫描文件清理候选，不执行删除' })
  async scanCandidates(@Body() dto: ScanFileCleanupCandidatesDto) {
    return this.cleanupService.scanCandidates(dto);
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('file:delete')
  @ApiOperation({ summary: '确认删除文件清理候选' })
  async deleteCandidates(
    @Body() dto: DeleteFileCleanupCandidatesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cleanupService.deleteCandidates(dto.ids, user.id);
  }

  @Post('ignore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('file:delete')
  @ApiOperation({ summary: '忽略文件清理候选' })
  async ignoreCandidates(
    @Body() dto: IgnoreFileCleanupCandidatesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cleanupService.ignoreCandidates(dto.ids, user.id, dto.message);
  }
}
