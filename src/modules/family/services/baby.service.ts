import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BusinessException } from '~/common/exceptions/business.exception';
import { FileUtil } from '~/common/utils';
import { DEFAULT_FAMILY_MEDIA_MAX_SIZE } from '~/config/constants';
import { FileEntity, FileStorageType } from '~/modules/file/entities/file.entity';
import {
  OSS_IMAGE_AVATAR_PROCESS,
  OSS_IMAGE_FEED_PROCESS,
  OSS_IMAGE_PREVIEW_PROCESS,
} from '~/modules/file/image-process.constants';
import { FileService } from '~/modules/file/services/file.service';
import { AuthenticatedUser } from '~/modules/auth/strategies/jwt.strategy';
import { UserEntity } from '~/modules/user/entities/user.entity';
import { UserService } from '~/modules/user/services/user.service';
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
import { FAMILY_PRIVATE_MEDIA_CACHE_MAX_AGE_SECONDS } from '../family-media-cache.constants';

const BABY_BIRTHDAY_FILE_MODULE = 'baby-birthday';
const BABY_AVATAR_FILE_MODULE = 'baby-avatar';
const BABY_BIRTHDAY_ALLOWED_IMAGE_TYPES = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
  '.heif',
];

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
    private readonly fileService: FileService,
    private readonly userService: UserService,
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

  async findPublicOverviewPreview(): Promise<BabyOverviewResponseDto> {
    const [profile, latestGrowthRecord] = await Promise.all([
      this.profileRepository.findOne({
        where: {},
        relations: ['avatarFile'],
        order: { id: 'ASC' },
      }),
      this.growthRepository.findOne({
        where: {},
        order: { measuredAt: 'DESC', id: 'DESC' },
      }),
    ]);

    return {
      profile: profile ? await this.toProfileResponse(profile) : null,
      latestGrowthRecord: latestGrowthRecord
        ? this.toGrowthRecordResponse(latestGrowthRecord)
        : null,
      growthRecords: [],
      birthdays: [],
    };
  }

  async saveProfile(dto: SaveBabyProfileDto): Promise<BabyProfileResponseDto> {
    const existing = await this.profileRepository.findOne({ where: {}, order: { id: 'ASC' } });
    const avatarFileId = dto.avatarFileId ?? null;
    await this.ensureBabyAvatarFile(avatarFileId);
    const payload = {
      nickname: this.normalizeRequiredText(dto.nickname, '宝宝昵称不能为空'),
      birthDate: dto.birthDate,
      birthTime: this.normalizeOptionalText(dto.birthTime),
      avatarFileId,
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
    const result = await this.growthRepository.softDelete(id);
    if (!result.affected) {
      throw BusinessException.notFound('Baby growth record', id);
    }
  }

  async createBirthday(dto: CreateBabyBirthdayDto): Promise<BabyBirthdayResponseDto> {
    const existing = await this.birthdayRepository.findOne({ where: { year: dto.year } });
    if (existing) {
      throw BusinessException.duplicate('Baby birthday', 'year');
    }
    const coverFileId = dto.coverFileId ?? null;
    await this.ensureBabyBirthdayCoverFile(coverFileId);

    const saved = await this.birthdayRepository.save(
      this.birthdayRepository.create({
        year: dto.year,
        title: this.normalizeRequiredText(dto.title, '生日标题不能为空'),
        description: this.normalizeOptionalText(dto.description),
        coverFileId,
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

    if (dto.coverFileId !== undefined) {
      await this.ensureBabyBirthdayCoverFile(dto.coverFileId ?? null);
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
    const result = await this.birthdayRepository.softDelete(id);
    if (!result.affected) {
      throw BusinessException.notFound('Baby birthday', id);
    }
  }

  async uploadAvatarImage(file: Express.Multer.File, user: AuthenticatedUser): Promise<FileEntity> {
    if (!file) {
      throw BusinessException.validationFailed('请选择要上传的宝宝头像');
    }
    this.ensureImageMetadata(file.originalname, file.mimetype || 'application/octet-stream');

    return this.fileService.upload(
      file,
      {
        module: BABY_AVATAR_FILE_MODULE,
        tags: 'baby,avatar',
        isPublic: false,
        storage: FileStorageType.LOCAL,
        maxSize: DEFAULT_FAMILY_MEDIA_MAX_SIZE,
        allowedTypes: BABY_BIRTHDAY_ALLOWED_IMAGE_TYPES,
      },
      user.id,
    );
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
    const missingId = fileIds.find((_id, index) => !orderedFiles[index]);
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

  private async ensureBabyAvatarFile(fileId?: number | null): Promise<void> {
    await this.ensureBabyImageFile(fileId, BABY_AVATAR_FILE_MODULE, {
      moduleMismatch: '宝宝头像使用场景不匹配',
      notImage: '宝宝头像仅支持图片',
    });
  }

  private async ensureBabyBirthdayCoverFile(fileId?: number | null): Promise<void> {
    await this.ensureBabyImageFile(fileId, BABY_BIRTHDAY_FILE_MODULE, {
      moduleMismatch: '生日封面使用场景不匹配',
      notImage: '生日封面仅支持图片',
    });
  }

  private async ensureBabyImageFile(
    fileId: number | null | undefined,
    module: string,
    messages: { moduleMismatch: string; notImage: string },
  ): Promise<void> {
    if (fileId == null) {
      return;
    }

    const file = await this.fileRepository.findOne({ where: { id: fileId } });
    if (!file) {
      throw BusinessException.notFound('File', fileId);
    }
    if (file.module !== module) {
      throw BusinessException.validationFailed(messages.moduleMismatch);
    }

    this.ensureImageFile(file, messages.notImage);
  }

  private ensureHeightOrWeight(height?: number | string | null, weight?: number | string | null) {
    if (height === null && weight === null) {
      throw BusinessException.validationFailed('身高或体重至少填写一项');
    }
    if (height === undefined && weight === undefined) {
      throw BusinessException.validationFailed('身高或体重至少填写一项');
    }
  }

  private ensureImageFile(
    file: Pick<FileEntity, 'category' | 'mimeType' | 'originalName'>,
    message = '生日合辑仅支持图片',
  ): void {
    const mimeType = file.mimeType || '';
    if (file.category === 'image' || mimeType.startsWith('image/')) {
      return;
    }
    if (file.originalName && FileUtil.isImage(file.originalName)) {
      return;
    }
    throw BusinessException.validationFailed(message);
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
            process: OSS_IMAGE_AVATAR_PROCESS,
            cacheMaxAgeSeconds: FAMILY_PRIVATE_MEDIA_CACHE_MAX_AGE_SECONDS,
            file: profile.avatarFile ?? undefined,
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
              ...(birthday.coverFile?.storage === FileStorageType.OSS
                ? { process: OSS_IMAGE_FEED_PROCESS }
                : {}),
              cacheMaxAgeSeconds: FAMILY_PRIVATE_MEDIA_CACHE_MAX_AGE_SECONDS,
              file: birthday.coverFile ?? undefined,
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
      author: await this.toUserSummary(contribution.author),
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
      ...(media.file?.storage === FileStorageType.OSS ? { process: OSS_IMAGE_FEED_PROCESS } : {}),
      cacheMaxAgeSeconds: FAMILY_PRIVATE_MEDIA_CACHE_MAX_AGE_SECONDS,
      file: media.file,
    });
    const previewLink =
      media.file?.storage === FileStorageType.OSS
        ? await this.fileService.createTrustedAccessLink(media.fileId, {
            disposition: 'inline',
            process: OSS_IMAGE_PREVIEW_PROCESS,
            cacheMaxAgeSeconds: FAMILY_PRIVATE_MEDIA_CACHE_MAX_AGE_SECONDS,
            file: media.file,
          })
        : null;

    return {
      id: media.id,
      fileId: media.fileId,
      contributionId: media.contributionId ?? null,
      uploaderId: media.uploaderId,
      uploader: await this.toUserSummary(media.uploader),
      sort: media.sort,
      originalName: media.file?.originalName,
      mimeType: media.file?.mimeType,
      size: typeof media.file?.size === 'number' ? media.file.size : Number(media.file?.size ?? 0),
      displayUrl: link.url,
      ...(previewLink ? { previewUrl: previewLink.url } : {}),
      expiresAt: link.expiresAt,
      createdAt: media.createdAt,
    };
  }

  private async toUserSummary(user?: UserEntity | null) {
    if (!user) {
      return undefined;
    }

    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      realName: user.realName,
      avatar: await this.userService.resolveTrustedAvatarUrl(user.avatar),
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
