import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BusinessException } from '~/common/exceptions/business.exception';
import { FileUtil } from '~/common/utils';
import { DEFAULT_FAMILY_MEDIA_MAX_SIZE } from '~/config/constants';
import { FileEntity, FileStorageType } from '~/modules/file/entities/file.entity';
import { FileService } from '~/modules/file/services/file.service';
import { AuthenticatedUser } from '~/modules/auth/strategies/jwt.strategy';
import { UserEntity } from '~/modules/user/entities/user.entity';
import {
  BabyBirthdayContributionResponseDto,
  BabyBirthdayMediaResponseDto,
  BabyBirthdayResponseDto,
  BabyGrowthRecordResponseDto,
  BabyOverviewResponseDto,
  BabyProfileResponseDto,
  CreateBabyBirthdayContributionDto,
  CreateBabyBirthdayDto,
  CreateBabyGrowthRecordDto,
  SaveBabyProfileDto,
  UpdateBabyBirthdayDto,
  UpdateBabyGrowthRecordDto,
} from '../dto';
import {
  BabyBirthdayContributionEntity,
  BabyBirthdayEntity,
  BabyBirthdayMediaEntity,
  BabyGrowthRecordEntity,
  BabyProfileEntity,
} from '../entities';

const BABY_BIRTHDAY_FILE_MODULE = 'baby-birthday';
const BABY_BIRTHDAY_ALLOWED_IMAGE_TYPES = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
  '.heif',
];
const BABY_IMAGE_WEBP_PROCESS = 'image/format,webp/quality,Q_100';

@Injectable()
export class BabyService {
  constructor(
    @InjectRepository(BabyProfileEntity)
    private readonly profileRepository: Repository<BabyProfileEntity>,
    @InjectRepository(BabyGrowthRecordEntity)
    private readonly growthRepository: Repository<BabyGrowthRecordEntity>,
    @InjectRepository(BabyBirthdayEntity)
    private readonly birthdayRepository: Repository<BabyBirthdayEntity>,
    @InjectRepository(BabyBirthdayContributionEntity)
    private readonly contributionRepository: Repository<BabyBirthdayContributionEntity>,
    @InjectRepository(BabyBirthdayMediaEntity)
    private readonly mediaRepository: Repository<BabyBirthdayMediaEntity>,
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly fileService: FileService,
  ) {}

  async findOverview(): Promise<BabyOverviewResponseDto> {
    const [profile, growthRecords, birthdays] = await Promise.all([
      this.profileRepository.findOne({
        where: {},
        relations: ['avatarFile'],
        order: { id: 'ASC' },
      }),
      this.growthRepository.find({ order: { measuredAt: 'DESC', id: 'DESC' } }),
      this.birthdayRepository.find({
        relations: [
          'coverFile',
          'media',
          'media.file',
          'media.uploader',
          'contributions',
          'contributions.author',
          'contributions.media',
          'contributions.media.file',
          'contributions.media.uploader',
        ],
        order: { year: 'DESC' },
      }),
    ]);

    return {
      profile: profile ? await this.toProfileResponse(profile) : null,
      latestGrowthRecord: growthRecords[0] ? this.toGrowthRecordResponse(growthRecords[0]) : null,
      growthRecords: growthRecords.map((record) => this.toGrowthRecordResponse(record)),
      birthdays: await Promise.all(birthdays.map((birthday) => this.toBirthdayResponse(birthday))),
    };
  }

  async saveProfile(dto: SaveBabyProfileDto): Promise<BabyProfileResponseDto> {
    const existing = await this.profileRepository.findOne({ where: {}, order: { id: 'ASC' } });
    const payload = {
      nickname: this.normalizeRequiredText(dto.nickname, '宝宝昵称不能为空'),
      birthDate: dto.birthDate,
      birthTime: this.normalizeOptionalText(dto.birthTime),
      avatarFileId: dto.avatarFileId ?? null,
      birthHeightCm: this.normalizeOptionalNumber(dto.birthHeightCm),
      birthWeightKg: this.normalizeOptionalNumber(dto.birthWeightKg),
    };
    const saved = await this.profileRepository.save(
      existing ? Object.assign(existing, payload) : this.profileRepository.create(payload),
    );

    return this.toProfileResponse(saved);
  }

  async createGrowthRecord(dto: CreateBabyGrowthRecordDto): Promise<BabyGrowthRecordResponseDto> {
    this.ensureHeightOrWeight(dto.heightCm, dto.weightKg);
    const saved = await this.growthRepository.save(
      this.growthRepository.create({
        measuredAt: dto.measuredAt,
        heightCm: this.normalizeOptionalNumber(dto.heightCm),
        weightKg: this.normalizeOptionalNumber(dto.weightKg),
        remark: this.normalizeOptionalText(dto.remark),
      }),
    );

    return this.toGrowthRecordResponse(saved);
  }

  async updateGrowthRecord(
    id: number,
    dto: UpdateBabyGrowthRecordDto,
  ): Promise<BabyGrowthRecordResponseDto> {
    const record = await this.growthRepository.findOne({ where: { id } });
    if (!record) {
      throw BusinessException.notFound('Baby growth record', id);
    }

    const nextHeight = dto.heightCm !== undefined ? dto.heightCm : record.heightCm;
    const nextWeight = dto.weightKg !== undefined ? dto.weightKg : record.weightKg;
    this.ensureHeightOrWeight(nextHeight, nextWeight);

    Object.assign(record, {
      measuredAt: dto.measuredAt ?? record.measuredAt,
      heightCm:
        dto.heightCm !== undefined ? this.normalizeOptionalNumber(dto.heightCm) : record.heightCm,
      weightKg:
        dto.weightKg !== undefined ? this.normalizeOptionalNumber(dto.weightKg) : record.weightKg,
      remark: dto.remark !== undefined ? this.normalizeOptionalText(dto.remark) : record.remark,
    });

    return this.toGrowthRecordResponse(await this.growthRepository.save(record));
  }

  async deleteGrowthRecord(id: number): Promise<void> {
    await this.growthRepository.softDelete(id);
  }

  async createBirthday(dto: CreateBabyBirthdayDto): Promise<BabyBirthdayResponseDto> {
    const existing = await this.birthdayRepository.findOne({ where: { year: dto.year } });
    if (existing) {
      throw BusinessException.duplicate('Baby birthday', 'year');
    }

    const saved = await this.birthdayRepository.save(
      this.birthdayRepository.create({
        year: dto.year,
        title: this.normalizeRequiredText(dto.title, '生日标题不能为空'),
        description: this.normalizeOptionalText(dto.description),
        coverFileId: dto.coverFileId ?? null,
      }),
    );

    return this.toBirthdayResponse(saved);
  }

  async updateBirthday(id: number, dto: UpdateBabyBirthdayDto): Promise<BabyBirthdayResponseDto> {
    const birthday = await this.birthdayRepository.findOne({ where: { id } });
    if (!birthday) {
      throw BusinessException.notFound('Baby birthday', id);
    }
    if (dto.year !== undefined && dto.year !== birthday.year) {
      const existing = await this.birthdayRepository.findOne({ where: { year: dto.year } });
      if (existing) {
        throw BusinessException.duplicate('Baby birthday', 'year');
      }
    }

    Object.assign(birthday, {
      year: dto.year ?? birthday.year,
      title:
        dto.title !== undefined
          ? this.normalizeRequiredText(dto.title, '生日标题不能为空')
          : birthday.title,
      description:
        dto.description !== undefined
          ? this.normalizeOptionalText(dto.description)
          : birthday.description,
      coverFileId: dto.coverFileId !== undefined ? (dto.coverFileId ?? null) : birthday.coverFileId,
    });

    return this.toBirthdayResponse(await this.birthdayRepository.save(birthday));
  }

  async deleteBirthday(id: number): Promise<void> {
    await this.birthdayRepository.softDelete(id);
  }

  async uploadBirthdayImage(
    birthdayId: number,
    file: Express.Multer.File,
    user: AuthenticatedUser,
  ): Promise<FileEntity> {
    if (!file) {
      throw BusinessException.validationFailed('请选择要上传的生日图片');
    }
    await this.ensureBirthdayExists(birthdayId);
    this.ensureImageMetadata(file.originalname, file.mimetype || 'application/octet-stream');

    return this.fileService.upload(
      file,
      {
        module: BABY_BIRTHDAY_FILE_MODULE,
        tags: 'baby,birthday',
        isPublic: false,
        storage: FileStorageType.LOCAL,
        maxSize: DEFAULT_FAMILY_MEDIA_MAX_SIZE,
        allowedTypes: BABY_BIRTHDAY_ALLOWED_IMAGE_TYPES,
      },
      user.id,
    );
  }

  async createContribution(
    birthdayId: number,
    dto: CreateBabyBirthdayContributionDto,
    user: AuthenticatedUser,
  ): Promise<BabyBirthdayContributionResponseDto> {
    await this.ensureBirthdayExists(birthdayId);
    const content = this.normalizeOptionalText(dto.content);
    const mediaFileIds = this.normalizeFileIds(dto.mediaFileIds);
    if (!content && mediaFileIds.length === 0) {
      throw BusinessException.validationFailed('祝福内容或生日图片不能为空');
    }
    const files = await this.ensureUsableBirthdayImages(mediaFileIds, user.id);

    const contribution = await this.contributionRepository.save(
      this.contributionRepository.create({
        birthdayId,
        authorId: user.id,
        content,
      }),
    );

    const media =
      files.length > 0
        ? await this.mediaRepository.save(
            this.mediaRepository.create(
              files.map((file, index) => ({
                birthdayId,
                contributionId: contribution.id,
                fileId: file.id,
                uploaderId: user.id,
                sort: index,
              })),
            ),
          )
        : [];

    return this.toContributionResponse(Object.assign(contribution, { media }));
  }

  async deleteContribution(id: number, user: AuthenticatedUser): Promise<void> {
    const contribution = await this.contributionRepository.findOne({ where: { id } });
    if (!contribution) {
      throw BusinessException.notFound('Baby birthday contribution', id);
    }
    if (contribution.authorId !== user.id) {
      throw BusinessException.forbidden('只能删除自己提交的生日祝福');
    }

    await this.mediaRepository.softDelete({ contributionId: id });
    await this.contributionRepository.softDelete(id);
  }

  private async ensureBirthdayExists(id: number): Promise<BabyBirthdayEntity> {
    const birthday = await this.birthdayRepository.findOne({ where: { id } });
    if (!birthday) {
      throw BusinessException.notFound('Baby birthday', id);
    }

    return birthday;
  }

  private async ensureUsableBirthdayImages(
    fileIds: number[],
    userId: number,
  ): Promise<FileEntity[]> {
    if (fileIds.length === 0) {
      return [];
    }

    const files = await this.fileRepository.find({ where: { id: In(fileIds) } });
    const fileMap = new Map(files.map((file) => [file.id, file]));
    const orderedFiles = fileIds.map((id) => fileMap.get(id));
    const missingId = fileIds.find((id, index) => !orderedFiles[index]);
    if (missingId) {
      throw BusinessException.notFound('File', missingId);
    }

    for (const file of orderedFiles as FileEntity[]) {
      if (file.uploaderId !== userId) {
        throw BusinessException.forbidden('只能使用自己上传的生日图片');
      }
      if (file.module !== BABY_BIRTHDAY_FILE_MODULE) {
        throw BusinessException.validationFailed('生日图片使用场景不匹配');
      }
      if (file.storage !== FileStorageType.OSS && file.storage !== FileStorageType.LOCAL) {
        throw BusinessException.validationFailed('生日图片存储类型不支持');
      }
      this.ensureImageFile(file);
    }

    return orderedFiles as FileEntity[];
  }

  private ensureHeightOrWeight(height?: number | string | null, weight?: number | string | null) {
    if (height === null && weight === null) {
      throw BusinessException.validationFailed('身高或体重至少填写一项');
    }
    if (height === undefined && weight === undefined) {
      throw BusinessException.validationFailed('身高或体重至少填写一项');
    }
  }

  private ensureImageFile(file: Pick<FileEntity, 'category' | 'mimeType' | 'originalName'>): void {
    const mimeType = file.mimeType || '';
    if (file.category === 'image' || mimeType.startsWith('image/')) {
      return;
    }
    if (file.originalName && FileUtil.isImage(file.originalName)) {
      return;
    }
    throw BusinessException.validationFailed('生日合辑仅支持图片');
  }

  private ensureImageMetadata(originalName: string, mimeType: string): void {
    if (mimeType.startsWith('image/') || FileUtil.isImage(originalName)) {
      return;
    }
    throw BusinessException.validationFailed('生日合辑仅支持图片');
  }

  private async toProfileResponse(profile: BabyProfileEntity): Promise<BabyProfileResponseDto> {
    const avatarUrl = profile.avatarFileId
      ? (
          await this.fileService.createTrustedAccessLink(profile.avatarFileId, {
            disposition: 'inline',
          })
        ).url
      : null;

    return {
      id: profile.id,
      nickname: profile.nickname,
      birthDate: profile.birthDate,
      birthTime: profile.birthTime ?? null,
      avatarFileId: profile.avatarFileId ?? null,
      avatarUrl,
      birthHeightCm: this.toOptionalNumber(profile.birthHeightCm),
      birthWeightKg: this.toOptionalNumber(profile.birthWeightKg),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private toGrowthRecordResponse(record: BabyGrowthRecordEntity): BabyGrowthRecordResponseDto {
    return {
      id: record.id,
      measuredAt: record.measuredAt,
      heightCm: this.toOptionalNumber(record.heightCm),
      weightKg: this.toOptionalNumber(record.weightKg),
      remark: record.remark ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async toBirthdayResponse(birthday: BabyBirthdayEntity): Promise<BabyBirthdayResponseDto> {
    const media = [...(birthday.media ?? [])].sort((left, right) => {
      const sortDiff = (left.sort ?? 0) - (right.sort ?? 0);
      if (sortDiff !== 0) {
        return sortDiff;
      }

      const createdAtDiff =
        (left.createdAt?.getTime?.() ?? 0) - (right.createdAt?.getTime?.() ?? 0);
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }

      return left.id - right.id;
    });
    const contributions = [...(birthday.contributions ?? [])].sort(
      (left, right) => (left.createdAt?.getTime?.() ?? 0) - (right.createdAt?.getTime?.() ?? 0),
    );
    const mediaResponses = await Promise.all(media.map((item) => this.toMediaResponse(item)));
    const coverUrl =
      birthday.coverFileId != null
        ? (
            await this.fileService.createTrustedAccessLink(birthday.coverFileId, {
              disposition: 'inline',
              process: BABY_IMAGE_WEBP_PROCESS,
            })
          ).url
        : (mediaResponses[0]?.displayUrl ?? null);

    return {
      id: birthday.id,
      year: birthday.year,
      title: birthday.title,
      description: birthday.description ?? null,
      coverFileId: birthday.coverFileId ?? null,
      coverUrl,
      mediaCount: media.length,
      contributionCount: contributions.length,
      media: mediaResponses,
      contributions: await Promise.all(
        contributions.map((contribution) => this.toContributionResponse(contribution)),
      ),
      createdAt: birthday.createdAt,
      updatedAt: birthday.updatedAt,
    };
  }

  private async toContributionResponse(
    contribution: BabyBirthdayContributionEntity,
  ): Promise<BabyBirthdayContributionResponseDto> {
    return {
      id: contribution.id,
      birthdayId: contribution.birthdayId,
      authorId: contribution.authorId,
      author: this.toUserSummary(contribution.author),
      content: contribution.content ?? null,
      media: await Promise.all(
        (contribution.media ?? []).map((item) => this.toMediaResponse(item)),
      ),
      createdAt: contribution.createdAt,
      updatedAt: contribution.updatedAt,
    };
  }

  private async toMediaResponse(
    media: BabyBirthdayMediaEntity,
  ): Promise<BabyBirthdayMediaResponseDto> {
    const link = await this.fileService.createTrustedAccessLink(media.fileId, {
      disposition: 'inline',
      process: BABY_IMAGE_WEBP_PROCESS,
    });

    return {
      id: media.id,
      fileId: media.fileId,
      contributionId: media.contributionId ?? null,
      uploaderId: media.uploaderId,
      uploader: this.toUserSummary(media.uploader),
      sort: media.sort,
      originalName: media.file?.originalName,
      mimeType: media.file?.mimeType,
      size: typeof media.file?.size === 'number' ? media.file.size : Number(media.file?.size ?? 0),
      displayUrl: link.url,
      expiresAt: link.expiresAt,
      createdAt: media.createdAt,
    };
  }

  private toUserSummary(user?: UserEntity | null) {
    if (!user) {
      return undefined;
    }

    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      realName: user.realName,
      avatar: user.avatar,
    };
  }

  private normalizeOptionalText(value?: string | null): string | null {
    const text = value?.trim();
    return text || null;
  }

  private normalizeRequiredText(value: string, message: string): string {
    const text = value.trim();
    if (!text) {
      throw BusinessException.validationFailed(message);
    }

    return text;
  }

  private normalizeOptionalNumber(value?: number | string | null): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return Number(value);
  }

  private normalizeFileIds(value?: number[]): number[] {
    return Array.from(new Set(value ?? [])).filter((id) => Number.isInteger(id) && id > 0);
  }

  private toOptionalNumber(value?: number | string | null): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return Number(value);
  }
}
