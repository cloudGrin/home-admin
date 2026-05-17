import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { RequirePermissions } from '~/core/decorators';
import { CurrentUser } from '~/modules/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '~/modules/auth/strategies/jwt.strategy';
import {
  CompleteDirectUploadDto,
  CreateDirectUploadDto,
} from '~/modules/file/dto/direct-upload.dto';
import {
  CreateInsurancePolicyDto,
  QueryInsurancePolicyDto,
  UpdateInsurancePolicyDto,
} from '../dto';
import { InsurancePolicyService } from '../services/insurance-policy.service';

@ApiTags('家庭保险保单')
@ApiBearerAuth()
@Controller('insurance-policies')
export class InsurancePolicyController {
  constructor(private readonly policyService: InsurancePolicyService) {}

  @Get()
  @RequirePermissions('insurance:read')
  @ApiOperation({ summary: '获取保单列表' })
  async findPolicies(@Query() query: QueryInsurancePolicyDto) {
    return this.policyService.findPolicies(query);
  }

  @Get('family-view')
  @RequirePermissions('insurance:read')
  @ApiOperation({ summary: '获取保险家庭视图' })
  async findFamilyView() {
    return this.policyService.findFamilyView();
  }

  @Post()
  @RequirePermissions('insurance:create')
  @ApiOperation({ summary: '创建保单' })
  async createPolicy(
    @Body() dto: CreateInsurancePolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policyService.createPolicy(dto, user);
  }

  @Get(':id')
  @RequirePermissions('insurance:read')
  @ApiOperation({ summary: '获取保单详情' })
  async findPolicy(@Param('id', ParseIntPipe) id: number) {
    return this.policyService.findPolicy(id);
  }

  @Put(':id')
  @RequirePermissions('insurance:update')
  @ApiOperation({ summary: '更新保单' })
  async updatePolicy(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInsurancePolicyDto) {
    return this.policyService.updatePolicy(id, dto);
  }

  @Post('attachments/upload')
  @RequirePermissions('insurance:create', 'insurance:update')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: '上传保单附件' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '保单合同附件',
        },
      },
    },
  })
  async uploadAttachment(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policyService.uploadAttachment(file, user);
  }

  @Post('attachments/direct-upload/initiate')
  @RequirePermissions('insurance:create', 'insurance:update')
  @ApiOperation({ summary: '初始化保单附件 OSS 直传' })
  async createAttachmentDirectUpload(
    @Body() dto: CreateDirectUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policyService.createAttachmentDirectUpload(dto, user);
  }

  @Post('attachments/direct-upload/complete')
  @RequirePermissions('insurance:create', 'insurance:update')
  @ApiOperation({ summary: '完成保单附件 OSS 直传' })
  async completeAttachmentDirectUpload(@Body() dto: CompleteDirectUploadDto) {
    return this.policyService.completeAttachmentDirectUpload(dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('insurance:delete')
  @ApiOperation({ summary: '删除保单' })
  async removePolicy(@Param('id', ParseIntPipe) id: number) {
    await this.policyService.removePolicy(id);
  }

  @Get(':id/attachments/:fileId/download')
  @RequirePermissions('insurance:read')
  @ApiOperation({ summary: '下载保单附件' })
  async downloadAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.policyService.getAttachmentDownload(id, fileId);
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
