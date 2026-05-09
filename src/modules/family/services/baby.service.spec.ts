import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from '~/common/exceptions/business.exception';
import { createMockRepository } from '~/test-utils';
import { FileEntity, FileStorageType } from '~/modules/file/entities/file.entity';
import { FileService } from '~/modules/file/services/file.service';
import { UserEntity } from '~/modules/user/entities/user.entity';
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

  it('rejects duplicate birthday years when backend creates annual albums', async () => {
    birthdayRepository.findOne.mockResolvedValue(
      Object.assign(new BabyBirthdayEntity(), { id: 21, year: 2027 }),
    );

    await expect(service.createBirthday({ year: 2027, title: '一周岁生日' })).rejects.toThrow(
      BusinessException,
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
