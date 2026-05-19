import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from '~/common/exceptions/business.exception';
import { createMockRepository } from '~/test-utils';
import { FileEntity, FileStorageType } from '~/modules/file/entities/file.entity';
import { FileService } from '~/modules/file/services/file.service';
import { UserEntity } from '~/modules/user/entities/user.entity';
import { UserService } from '~/modules/user/services/user.service';
import {
  BabyBirthdayContributionEntity,
  BabyBirthdayEntity,
  BabyBirthdayMediaEntity,
  BabyGrowthRecordEntity,
  BabyProfileEntity,
} from '../entities';
import { BabyService } from './baby.service';

describe('BabyService', () => {
  let service: BabyService;
  let profileRepository: jest.Mocked<Repository<BabyProfileEntity>>;
  let growthRepository: jest.Mocked<Repository<BabyGrowthRecordEntity>>;
  let birthdayRepository: jest.Mocked<Repository<BabyBirthdayEntity>>;
  let contributionRepository: jest.Mocked<Repository<BabyBirthdayContributionEntity>>;
  let mediaRepository: jest.Mocked<Repository<BabyBirthdayMediaEntity>>;
  let fileRepository: jest.Mocked<Repository<FileEntity>>;
  let fileService: jest.Mocked<FileService>;
  let userService: jest.Mocked<Pick<UserService, 'resolveTrustedAvatarUrl'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BabyService,
        { provide: getRepositoryToken(BabyProfileEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(BabyGrowthRecordEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(BabyBirthdayEntity), useValue: createMockRepository() },
        {
          provide: getRepositoryToken(BabyBirthdayContributionEntity),
          useValue: createMockRepository(),
        },
        { provide: getRepositoryToken(BabyBirthdayMediaEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(FileEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(UserEntity), useValue: createMockRepository() },
        {
          provide: FileService,
          useValue: {
            upload: jest.fn(),
            createTrustedAccessLink: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            resolveTrustedAvatarUrl: jest.fn(async (avatar?: string | null) => avatar),
          },
        },
      ],
    }).compile();

    service = module.get(BabyService);
    profileRepository = module.get(getRepositoryToken(BabyProfileEntity));
    growthRepository = module.get(getRepositoryToken(BabyGrowthRecordEntity));
    birthdayRepository = module.get(getRepositoryToken(BabyBirthdayEntity));
    contributionRepository = module.get(getRepositoryToken(BabyBirthdayContributionEntity));
    mediaRepository = module.get(getRepositoryToken(BabyBirthdayMediaEntity));
    fileRepository = module.get(getRepositoryToken(FileEntity));
    fileService = module.get(FileService);
    userService = module.get(UserService) as jest.Mocked<
      Pick<UserService, 'resolveTrustedAvatarUrl'>
    >;

    profileRepository.create.mockImplementation((data) => data as BabyProfileEntity);
    profileRepository.save.mockImplementation(async (data) =>
      Object.assign(new BabyProfileEntity(), data, { id: 1 }),
    );
    growthRepository.create.mockImplementation((data) => data as BabyGrowthRecordEntity);
    growthRepository.save.mockImplementation(async (data) =>
      Object.assign(new BabyGrowthRecordEntity(), data, { id: 2 }),
    );
    birthdayRepository.create.mockImplementation((data) => data as BabyBirthdayEntity);
    birthdayRepository.save.mockImplementation(async (data) =>
      Object.assign(new BabyBirthdayEntity(), data, { id: 3 }),
    );
    contributionRepository.create.mockImplementation(
      (data) => data as BabyBirthdayContributionEntity,
    );
    contributionRepository.save.mockImplementation(async (data) =>
      Object.assign(new BabyBirthdayContributionEntity(), data, { id: 4 }),
    );
    mediaRepository.create.mockImplementation((data) => data as BabyBirthdayMediaEntity);
    mediaRepository.save.mockImplementation(async (data) => data as BabyBirthdayMediaEntity[]);
    fileService.createTrustedAccessLink.mockImplementation(async (fileId) => ({
      url: `/private/files/${fileId}`,
      expiresAt: '2026-05-10T10:00:00.000Z',
    }));
  });

  it('returns baby overview with latest growth record and birthday counts', async () => {
    profileRepository.findOne.mockResolvedValue(
      Object.assign(new BabyProfileEntity(), {
        id: 1,
        nickname: '小葡萄',
        birthDate: '2026-02-01',
      }),
    );
    growthRepository.find.mockResolvedValue([
      Object.assign(new BabyGrowthRecordEntity(), {
        id: 12,
        measuredAt: '2026-05-01',
        heightCm: '61.5',
        weightKg: '6.80',
      }),
      Object.assign(new BabyGrowthRecordEntity(), {
        id: 11,
        measuredAt: '2026-04-01',
        heightCm: '58.0',
        weightKg: '5.90',
      }),
    ]);
    birthdayRepository.find.mockResolvedValue([
      Object.assign(new BabyBirthdayEntity(), {
        id: 21,
        year: 2027,
        title: '一周岁生日',
        media: [Object.assign(new BabyBirthdayMediaEntity(), { id: 31, fileId: 41 })],
        contributions: [
          Object.assign(new BabyBirthdayContributionEntity(), { id: 51, content: '生日快乐' }),
        ],
      }),
    ]);

    const overview = await service.findOverview();

    expect(overview.profile?.nickname).toBe('小葡萄');
    expect(overview.latestGrowthRecord).toEqual(
      expect.objectContaining({ id: 12, heightCm: 61.5, weightKg: 6.8 }),
    );
    expect(overview.birthdays[0]).toEqual(
      expect.objectContaining({ year: 2027, mediaCount: 1, contributionCount: 1 }),
    );
  });

  it('returns a public baby summary without birthday albums or full growth history', async () => {
    profileRepository.findOne.mockResolvedValue(
      Object.assign(new BabyProfileEntity(), {
        id: 1,
        nickname: '小葡萄',
        birthDate: '2026-02-01',
        avatarFileId: 10,
      }),
    );
    growthRepository.findOne.mockResolvedValue(
      Object.assign(new BabyGrowthRecordEntity(), {
        id: 12,
        measuredAt: '2026-05-01',
        heightCm: '61.5',
        weightKg: '6.80',
      }),
    );

    const overview = await service.findPublicOverviewPreview();

    expect(profileRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        relations: ['avatarFile'],
      }),
    );
    expect(growthRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { measuredAt: 'DESC', id: 'DESC' },
      }),
    );
    expect(birthdayRepository.find).not.toHaveBeenCalled();
    expect(overview.profile?.nickname).toBe('小葡萄');
    expect(overview.latestGrowthRecord).toEqual(
      expect.objectContaining({ id: 12, heightCm: 61.5, weightKg: 6.8 }),
    );
    expect(overview.growthRecords).toEqual([]);
    expect(overview.birthdays).toEqual([]);
  });

  it('keeps birthday media ordering stable when multiple contributions reuse the same sort values', async () => {
    profileRepository.findOne.mockResolvedValue(
      Object.assign(new BabyProfileEntity(), {
        id: 1,
        nickname: '小葡萄',
        birthDate: '2026-02-01',
      }),
    );
    growthRepository.find.mockResolvedValue([]);
    birthdayRepository.find.mockResolvedValue([
      Object.assign(new BabyBirthdayEntity(), {
        id: 21,
        year: 2027,
        title: '一周岁生日',
        media: [
          Object.assign(new BabyBirthdayMediaEntity(), {
            id: 32,
            fileId: 42,
            sort: 1,
            createdAt: new Date('2027-02-01T10:03:00.000Z'),
          }),
          Object.assign(new BabyBirthdayMediaEntity(), {
            id: 31,
            fileId: 41,
            sort: 0,
            createdAt: new Date('2027-02-01T10:02:00.000Z'),
          }),
          Object.assign(new BabyBirthdayMediaEntity(), {
            id: 30,
            fileId: 40,
            sort: 0,
            createdAt: new Date('2027-02-01T10:01:00.000Z'),
          }),
        ],
        contributions: [],
      }),
    ]);

    const overview = await service.findOverview();

    expect(overview.birthdays[0].media.map((item) => item.id)).toEqual([30, 31, 32]);
    expect(overview.birthdays[0].coverUrl).toBe('/private/files/40');
  });

  it('uses private cache links with resized OSS image processing for baby images', async () => {
    profileRepository.findOne.mockResolvedValue(
      Object.assign(new BabyProfileEntity(), {
        id: 1,
        nickname: '小葡萄',
        birthDate: '2026-02-01',
        avatarFileId: 10,
        avatarFile: Object.assign(new FileEntity(), {
          id: 10,
          storage: FileStorageType.OSS,
          category: 'image',
          mimeType: 'image/jpeg',
        }),
      }),
    );
    growthRepository.find.mockResolvedValue([]);
    birthdayRepository.find.mockResolvedValue([
      Object.assign(new BabyBirthdayEntity(), {
        id: 21,
        year: 2027,
        title: '一周岁生日',
        coverFileId: 20,
        coverFile: Object.assign(new FileEntity(), {
          id: 20,
          storage: FileStorageType.OSS,
          category: 'image',
          mimeType: 'image/jpeg',
        }),
        media: [
          Object.assign(new BabyBirthdayMediaEntity(), {
            id: 31,
            fileId: 41,
            sort: 0,
            file: Object.assign(new FileEntity(), {
              id: 41,
              storage: FileStorageType.OSS,
              category: 'image',
              mimeType: 'image/jpeg',
            }),
          }),
        ],
        contributions: [],
      }),
    ]);

    await service.findOverview();

    expect(fileService.createTrustedAccessLink).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        disposition: 'inline',
        process: 'image/resize,l_256,m_lfit/format,webp/quality,Q_82',
        cacheMaxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    );
    expect(fileService.createTrustedAccessLink).toHaveBeenCalledWith(
      20,
      expect.objectContaining({
        disposition: 'inline',
        process: 'image/resize,l_1080,m_lfit/format,webp/quality,Q_82/interlace,1',
        cacheMaxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    );
    expect(fileService.createTrustedAccessLink).toHaveBeenCalledWith(
      41,
      expect.objectContaining({
        disposition: 'inline',
        process: 'image/resize,l_1080,m_lfit/format,webp/quality,Q_82/interlace,1',
        cacheMaxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    );
    expect(fileService.createTrustedAccessLink).toHaveBeenCalledWith(
      41,
      expect.objectContaining({
        disposition: 'inline',
        process: 'image/resize,l_1920,m_lfit/format,webp/quality,Q_86/interlace,1',
        cacheMaxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    );
  });

  it('rejects duplicate birthday years when backend creates annual albums', async () => {
    birthdayRepository.findOne.mockResolvedValue(
      Object.assign(new BabyBirthdayEntity(), { id: 21, year: 2027 }),
    );

    await expect(service.createBirthday({ year: 2027, title: '一周岁生日' })).rejects.toThrow(
      BusinessException,
    );
  });

  it('rejects baby avatar file ids outside the baby avatar module', async () => {
    profileRepository.findOne.mockResolvedValue(null);
    fileRepository.findOne.mockResolvedValue(
      Object.assign(new FileEntity(), {
        id: 70,
        module: 'insurance-policy',
        category: 'image',
        mimeType: 'image/jpeg',
      }),
    );

    await expect(
      service.saveProfile({
        nickname: '小葡萄',
        birthDate: '2026-02-01',
        avatarFileId: 70,
      }),
    ).rejects.toThrow(BusinessException);
    expect(profileRepository.save).not.toHaveBeenCalled();
  });

  it('rejects birthday cover file ids outside the baby birthday module when creating albums', async () => {
    birthdayRepository.findOne.mockResolvedValue(null);
    fileRepository.findOne.mockResolvedValue(
      Object.assign(new FileEntity(), {
        id: 72,
        module: 'insurance-policy',
        category: 'image',
        mimeType: 'image/jpeg',
      }),
    );

    await expect(
      service.createBirthday({
        year: 2027,
        title: '一周岁生日',
        coverFileId: 72,
      }),
    ).rejects.toThrow(BusinessException);
    expect(birthdayRepository.save).not.toHaveBeenCalled();
  });

  it('rejects non-image birthday cover file ids when updating albums', async () => {
    birthdayRepository.findOne.mockResolvedValue(
      Object.assign(new BabyBirthdayEntity(), {
        id: 21,
        year: 2027,
        title: '一周岁生日',
      }),
    );
    fileRepository.findOne.mockResolvedValue(
      Object.assign(new FileEntity(), {
        id: 73,
        module: 'baby-birthday',
        category: 'document',
        mimeType: 'application/pdf',
        originalName: 'policy.pdf',
      }),
    );

    await expect(service.updateBirthday(21, { coverFileId: 73 })).rejects.toThrow(
      BusinessException,
    );
    expect(birthdayRepository.save).not.toHaveBeenCalled();
  });

  it('rejects deleting an unknown growth record id', async () => {
    growthRepository.softDelete.mockResolvedValue({ affected: 0 } as any);

    await expect(service.deleteGrowthRecord(404)).rejects.toThrow(BusinessException);
  });

  it('rejects deleting an unknown birthday id', async () => {
    birthdayRepository.softDelete.mockResolvedValue({ affected: 0 } as any);

    await expect(service.deleteBirthday(404)).rejects.toThrow(BusinessException);
  });

  it('uses trusted avatar links for birthday contribution authors', async () => {
    profileRepository.findOne.mockResolvedValue(null);
    growthRepository.find.mockResolvedValue([]);
    birthdayRepository.find.mockResolvedValue([
      Object.assign(new BabyBirthdayEntity(), {
        id: 21,
        year: 2027,
        title: '一周岁生日',
        media: [],
        contributions: [
          Object.assign(new BabyBirthdayContributionEntity(), {
            id: 51,
            content: '生日快乐',
            author: Object.assign(new UserEntity(), {
              id: 3,
              username: 'mom',
              nickname: '妈妈',
              avatar: '/api/v1/files/50/public',
            }),
            media: [],
          }),
        ],
      }),
    ]);
    userService.resolveTrustedAvatarUrl.mockResolvedValue('/api/v1/files/50/access?token=avatar');

    const overview = await service.findOverview();

    expect(userService.resolveTrustedAvatarUrl).toHaveBeenCalledWith('/api/v1/files/50/public');
    expect(overview.birthdays[0].contributions[0].author?.avatar).toBe(
      '/api/v1/files/50/access?token=avatar',
    );
  });

  it('creates a mobile birthday contribution with owned birthday images', async () => {
    birthdayRepository.findOne.mockResolvedValue(
      Object.assign(new BabyBirthdayEntity(), { id: 21, year: 2027 }),
    );
    fileRepository.find.mockResolvedValue([
      Object.assign(new FileEntity(), {
        id: 71,
        uploaderId: 9,
        module: 'baby-birthday',
        storage: FileStorageType.LOCAL,
        mimeType: 'image/jpeg',
        category: 'image',
      }),
    ]);

    const contribution = await service.createContribution(
      21,
      { content: '愿你健康快乐', mediaFileIds: [71] },
      { id: 9, username: 'mom', email: 'mom@example.com', roles: [], sessionId: 's1' },
    );

    expect(contribution.id).toBe(4);
    expect(mediaRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        birthdayId: 21,
        contributionId: 4,
        fileId: 71,
        uploaderId: 9,
        sort: 0,
      }),
    ]);
  });

  it('uploads baby avatar images through the baby profile permission path', async () => {
    const avatarFile = {
      originalname: 'avatar.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;
    fileService.upload.mockResolvedValue(
      Object.assign(new FileEntity(), {
        id: 88,
        module: 'baby-avatar',
        mimeType: 'image/jpeg',
      }),
    );

    await service.uploadAvatarImage(avatarFile, {
      id: 1,
      username: 'admin',
      email: 'admin@example.com',
      roles: [],
      sessionId: 's1',
    });

    expect(fileService.upload).toHaveBeenCalledWith(
      avatarFile,
      expect.objectContaining({
        module: 'baby-avatar',
        tags: 'baby,avatar',
        isPublic: false,
        storage: FileStorageType.LOCAL,
      }),
      1,
    );
  });

  it('allows users to delete only their own birthday contributions', async () => {
    contributionRepository.findOne.mockResolvedValue(
      Object.assign(new BabyBirthdayContributionEntity(), { id: 4, authorId: 8 }),
    );

    await expect(
      service.deleteContribution(4, {
        id: 9,
        username: 'dad',
        email: 'dad@example.com',
        roles: [],
        sessionId: 's1',
      }),
    ).rejects.toThrow(BusinessException);
  });

  it('soft-deletes birthday contribution media when users delete their own contribution', async () => {
    contributionRepository.findOne.mockResolvedValue(
      Object.assign(new BabyBirthdayContributionEntity(), { id: 4, authorId: 9 }),
    );

    await service.deleteContribution(4, {
      id: 9,
      username: 'mom',
      email: 'mom@example.com',
      roles: [],
      sessionId: 's1',
    });

    expect(mediaRepository.softDelete).toHaveBeenCalledWith({ contributionId: 4 });
    expect(contributionRepository.softDelete).toHaveBeenCalledWith(4);
  });
});
