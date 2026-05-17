import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  HttpStatus,
  HttpCode,
  Body,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { StreamableFile } from '@nestjs/common';
import { FileService } from '../services/file.service';
import { UploadFileDto } from '../dto/upload-file.dto';
import { QueryFileDto } from '../dto/query-file.dto';
import { CompleteDirectUploadDto, CreateDirectUploadDto } from '../dto/direct-upload.dto';
import { CreateFileAccessLinkDto } from '../dto/file-access-link.dto';
import { RequirePermissions, CurrentUser, Public } from '~/core/decorators';
import { FileEntity, FileStorageType } from '../entities/file.entity';
import { BusinessException } from '~/common/exceptions/business.exception';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthenticatedUser } from '~/modules/auth/strategies/jwt.strategy';

function normalizeMulterOriginalName(originalName: string): string {
  if (!/[\u0080-\u00ff]/.test(originalName)) {
    return originalName;
  }

  const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
  if (!decoded || decoded.includes('\uFFFD')) {
    return originalName;
  }

  return decoded;
}

function setPrivateCacheHeader(res: Response, maxAgeSeconds?: number): void {
  if (!maxAgeSeconds || maxAgeSeconds <= 0) {
    return;
  }

  res.setHeader('Cache-Control', `private, max-age=${Math.floor(maxAgeSeconds)}`);
}

function setPublicCacheHeader(res: Response, maxAgeSeconds?: number): void {
  if (!maxAgeSeconds || maxAgeSeconds <= 0) {
    return;
  }

  res.setHeader('Cache-Control', `public, max-age=${Math.floor(maxAgeSeconds)}`);
}

@ApiTags('文件管理')
@ApiBearerAuth()
@Controller('files')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('file:upload')
  @ApiOperation({
    summary: '上传文件（直传）',
    description: '上传单个文件，默认最大文件大小为50MB。支持常见文件格式。',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '要上传的文件（默认最大50MB）',
        },
        module: {
          type: 'string',
          description: '业务模块标识',
          example: 'user-avatar',
        },
        tags: {
          type: 'string',
          description: '业务标签，逗号分隔',
          example: 'avatar,profile',
        },
        isPublic: {
          type: 'boolean',
          description: '是否公开访问',
          default: false,
        },
        remark: {
          type: 'string',
          description: '备注信息',
          maxLength: 500,
        },
        storage: {
          type: 'string',
          enum: Object.values(FileStorageType),
          description: '目标存储类型。不传时使用系统默认存储。',
        },
      },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ type: FileEntity })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // 检查文件是否存在，避免传递undefined到Service导致500错误
    if (!file) {
      throw BusinessException.validationFailed('请选择要上传的文件');
    }

    // multer 在部分 multipart 客户端下会把 UTF-8 文件名当成 Latin-1。
    if (file.originalname) {
      file.originalname = normalizeMulterOriginalName(file.originalname);
    }

    return this.fileService.upload(file, dto, user?.id);
  }

  @Get('storage-options')
  @RequirePermissions('file:read')
  @ApiOperation({ summary: '获取可用文件存储选项' })
  @ApiOkResponse({ description: '获取文件存储选项成功' })
  async getStorageOptions() {
    return this.fileService.getStorageOptions();
  }

  @Post('direct-upload/initiate')
  @RequirePermissions('file:upload')
  @ApiOperation({ summary: '初始化 OSS 直传' })
  @ApiCreatedResponse({ description: '创建 OSS 直传签名成功' })
  @ApiBadRequestResponse({ description: '参数验证失败或 OSS 未启用' })
  async createDirectUpload(
    @Body() dto: CreateDirectUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fileService.createDirectUpload(dto, user?.id);
  }

  @Post('direct-upload/complete')
  @RequirePermissions('file:upload')
  @ApiOperation({ summary: '完成 OSS 直传并创建文件记录' })
  @ApiCreatedResponse({ type: FileEntity })
  @ApiBadRequestResponse({ description: '上传令牌无效或 OSS 对象校验失败' })
  async completeDirectUpload(@Body() dto: CompleteDirectUploadDto) {
    return this.fileService.completeDirectUpload(dto);
  }

  @Get()
  @RequirePermissions('file:read')
  @ApiOperation({ summary: '获取文件列表' })
  @ApiOkResponse({ description: '获取文件列表成功' })
  @ApiBadRequestResponse({ description: '参数验证失败' })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  async findAll(@Query() query: QueryFileDto) {
    return this.fileService.findFiles(query);
  }

  @Get(':id')
  @RequirePermissions('file:read')
  @ApiOperation({ summary: '获取文件详情' })
  @ApiParam({ name: 'id', description: '文件ID' })
  @ApiOkResponse({ type: FileEntity })
  @ApiUnauthorizedResponse({ description: '用户未认证或 token 已过期' })
  @ApiForbiddenResponse({ description: '用户无权限访问该资源' })
  @ApiNotFoundResponse({ description: '请求的资源不存在' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.fileService.findById(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('file:delete')
  @ApiOperation({ summary: '删除文件' })
  @ApiParam({ name: 'id', description: '文件ID' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.fileService.remove(id);
  }

  @Get(':id/public')
  @Public()
  @ApiOperation({ summary: '公开下载文件' })
  @ApiParam({ name: 'id', description: '文件ID' })
  async publicDownload(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.fileService.getPublicDownload(id);
    setPublicCacheHeader(res, result.cacheMaxAgeSeconds);
    if (result.redirectUrl) {
      res.redirect(302, result.redirectUrl);
      return;
    }

    res.setHeader('Content-Type', result.file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(result.file.originalName)}`,
    );

    return new StreamableFile(result.stream as any);
  }

  @Post(':id/access-link')
  @RequirePermissions('file:download')
  @ApiOperation({ summary: '创建文件临时访问链接' })
  @ApiParam({ name: 'id', description: '文件ID' })
  @ApiOkResponse({ description: '创建文件临时访问链接成功' })
  async createAccessLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFileAccessLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fileService.createAccessLink(id, user, dto);
  }

  @Get(':id/access')
  @Public()
  @ApiOperation({ summary: '通过临时访问链接访问文件' })
  @ApiParam({ name: 'id', description: '文件ID' })
  async accessByLink(
    @Param('id', ParseIntPipe) id: number,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!token) {
      throw BusinessException.forbidden('访问链接无效或已过期');
    }

    const result = await this.fileService.resolveAccessLink(id, token);
    setPrivateCacheHeader(res, result.cacheMaxAgeSeconds);
    if (result.redirectUrl) {
      res.redirect(302, result.redirectUrl);
      return;
    }

    res.setHeader('Content-Type', result.file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${result.disposition}; filename*=UTF-8''${encodeURIComponent(result.file.originalName)}`,
    );

    (result.stream as NodeJS.ReadableStream).pipe(res);
  }

  @Get(':id/download')
  @RequirePermissions('file:download')
  @ApiOperation({ summary: '下载文件' })
  @ApiParam({ name: 'id', description: '文件ID' })
  async download(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.fileService.findById(id);

    // 权限检查：如果文件不是公开的，需要验证访问权限
    this.fileService.checkDownloadPermission(file, user);

    const result = await this.fileService.getDownloadResult(id, 'attachment');
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
}
