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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAuthenticated, RequirePermissions } from '~/core/decorators';
import { CurrentUser } from '~/modules/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '~/modules/auth/strategies/jwt.strategy';
import {
  CreateBabyBirthdayContributionDto,
  CreateBabyBirthdayDto,
  CreateBabyGrowthRecordDto,
  SaveBabyProfileDto,
  UpdateBabyBirthdayDto,
  UpdateBabyGrowthRecordDto,
} from '../dto';
import { BabyService } from '../services/baby.service';

@ApiTags('宝宝档案')
@ApiBearerAuth()
@Controller('family/baby')
export class FamilyBabyController {
  constructor(private readonly babyService: BabyService) {}

  @Get()
  @AllowAuthenticated()
  @ApiOperation({ summary: '获取宝宝档案概览' })
  async findOverview() {
    return this.babyService.findOverview();
  }

  @Put('profile')
  @RequirePermissions('baby:update')
  @ApiOperation({ summary: '保存宝宝基础资料' })
  async saveProfile(@Body() dto: SaveBabyProfileDto) {
    return this.babyService.saveProfile(dto);
  }

  @Post('avatar/upload')
  @RequirePermissions('baby:update')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: '上传宝宝头像' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '宝宝头像图片文件',
        },
      },
    },
  })
  async uploadAvatarImage(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.babyService.uploadAvatarImage(file, user);
  }

  @Post('growth-records')
  @RequirePermissions('baby:update')
  @ApiOperation({ summary: '新增宝宝成长记录' })
  async createGrowthRecord(@Body() dto: CreateBabyGrowthRecordDto) {
    return this.babyService.createGrowthRecord(dto);
  }

  @Put('growth-records/:id')
  @RequirePermissions('baby:update')
  @ApiOperation({ summary: '更新宝宝成长记录' })
  async updateGrowthRecord(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBabyGrowthRecordDto,
  ) {
    return this.babyService.updateGrowthRecord(id, dto);
  }

  @Delete('growth-records/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('baby:update')
  @ApiOperation({ summary: '删除宝宝成长记录' })
  async deleteGrowthRecord(@Param('id', ParseIntPipe) id: number) {
    await this.babyService.deleteGrowthRecord(id);
  }

  @Post('birthdays')
  @RequirePermissions('baby:update')
  @ApiOperation({ summary: '后台创建宝宝年度生日合辑' })
  async createBirthday(@Body() dto: CreateBabyBirthdayDto) {
    return this.babyService.createBirthday(dto);
  }

  @Put('birthdays/:id')
  @RequirePermissions('baby:update')
  @ApiOperation({ summary: '后台更新宝宝年度生日合辑' })
  async updateBirthday(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBabyBirthdayDto,
  ) {
    return this.babyService.updateBirthday(id, dto);
  }

  @Delete('birthdays/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('baby:update')
  @ApiOperation({ summary: '后台删除宝宝年度生日合辑' })
  async deleteBirthday(@Param('id', ParseIntPipe) id: number) {
    await this.babyService.deleteBirthday(id);
  }

  @Post('birthdays/:id/media/upload')
  @AllowAuthenticated()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: '移动端上传生日图片' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '生日图片文件',
        },
      },
    },
  })
  async uploadBirthdayImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.babyService.uploadBirthdayImage(id, file, user);
  }

  @Post('birthdays/:id/contributions')
  @AllowAuthenticated()
  @ApiOperation({ summary: '移动端提交生日祝福和图片' })
  async createContribution(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateBabyBirthdayContributionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.babyService.createContribution(id, dto, user);
  }

  @Delete('birthday-contributions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowAuthenticated()
  @ApiOperation({ summary: '删除自己的生日祝福' })
  async deleteContribution(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.babyService.deleteContribution(id, user);
  }
}
