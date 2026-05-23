import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoggerService } from '~/shared/logger/logger.service';
import { createMockLogger, createMockRepository } from '~/test-utils';
import { FileEntity, FileStorageType } from '../entities/file.entity';
import {
  FileCleanupCandidateEntity,
  FileCleanupCandidateSource,
  FileCleanupCandidateStatus,
} from '../entities/file-cleanup-candidate.entity';
import { FileStorageFactory } from '../storage/storage.factory';
import { FileService } from './file.service';
import { FileCleanupService } from './file-cleanup.service';

describe('FileCleanupService', () => {
  let service: FileCleanupService;
  let candidateRepository: any;
  let fileRepository: any;
  let fileQueryBuilder: any;
  let dataSource: jest.Mocked<Pick<DataSource, 'query'>>;
  let fileService: jest.Mocked<Pick<FileService, 'remove'>>;
  let storageFactory: {
    getAvailableStorageTypes: jest.Mock;
    getOssStrategy: jest.Mock;
  };
  let ossStrategy: {
    listObjects: jest.Mock;
    delete: jest.Mock;
  };

  const createFile = (overrides?: Partial<FileEntity>) =>
    Object.assign(new FileEntity(), {
      id: 21,
      originalName: 'photo.jpg',
      filename: 'photo.jpg',
      path: 'family-chat/2026/05/20/photo.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      category: 'image',
      storage: FileStorageType.OSS,
      module: 'family-chat',
      isPublic: false,
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
      updatedAt: new Date('2026-05-19T00:00:00.000Z'),
      ...overrides,
    });

  const createCandidate = (overrides?: Partial<FileCleanupCandidateEntity>) =>
    Object.assign(new FileCleanupCandidateEntity(), {
      id: 1,
      identity: 'db:21',
      source: FileCleanupCandidateSource.DB_ORPHAN,
      status: FileCleanupCandidateStatus.PENDING,
      storage: FileStorageType.OSS,
      module: 'family-chat',
      fileId: 21,
      objectKey: 'family-chat/2026/05/20/photo.jpg',
      reason: 'no_business_reference',
      createdAt: new Date('2026-05-21T00:00:00.000Z'),
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
      ...overrides,
    });

  beforeEach(async () => {
    candidateRepository = createMockRepository<FileCleanupCandidateEntity>();
    fileRepository = createMockRepository<FileEntity>();
    dataSource = { query: jest.fn() };
    fileService = { remove: jest.fn().mockResolvedValue(undefined) };
    ossStrategy = {
      listObjects: jest.fn().mockResolvedValue({
        objects: [],
        isTruncated: false,
        nextContinuationToken: null,
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    storageFactory = {
      getAvailableStorageTypes: jest
        .fn()
        .mockReturnValue([FileStorageType.LOCAL, FileStorageType.OSS]),
      getOssStrategy: jest.fn(() => ossStrategy),
    };

    candidateRepository.create.mockImplementation((input: Partial<FileCleanupCandidateEntity>) =>
      Object.assign(new FileCleanupCandidateEntity(), input),
    );
    candidateRepository.save.mockImplementation(async (input: FileCleanupCandidateEntity) => input);
    candidateRepository.findOne.mockResolvedValue(null);
    candidateRepository.find.mockResolvedValue([]);
    fileRepository.find.mockResolvedValue([]);
    fileQueryBuilder = fileRepository.createQueryBuilder();
    fileRepository.createQueryBuilder.mockReturnValue(fileQueryBuilder);
    fileQueryBuilder.getMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileCleanupService,
        { provide: getRepositoryToken(FileCleanupCandidateEntity), useValue: candidateRepository },
        { provide: getRepositoryToken(FileEntity), useValue: fileRepository },
        { provide: DataSource, useValue: dataSource },
        { provide: FileService, useValue: fileService },
        { provide: FileStorageFactory, useValue: storageFactory },
        { provide: LoggerService, useValue: createMockLogger() },
      ],
    }).compile();

    service = module.get(FileCleanupService);
  });

  it('records old unreferenced file records as pending DB orphan candidates', async () => {
    const oldFile = createFile();
    fileQueryBuilder.getMany.mockResolvedValue([oldFile]);
    dataSource.query.mockResolvedValue([]);

    const result = await service.scanCandidates({
      now: new Date('2026-05-21T00:00:00.000Z'),
      fileOlderThanHours: 24,
      ossObjectOlderThanHours: 24,
      limit: 100,
    });

    expect(result.created).toBe(1);
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'db:21',
        source: FileCleanupCandidateSource.DB_ORPHAN,
        status: FileCleanupCandidateStatus.PENDING,
        fileId: 21,
        objectKey: 'family-chat/2026/05/20/photo.jpg',
        reason: 'no_business_reference',
      }),
    );
  });

  it('does not record file records that are still referenced by business tables', async () => {
    fileQueryBuilder.getMany.mockResolvedValue([createFile()]);
    dataSource.query.mockResolvedValue([{ id: 1 }]);

    const result = await service.scanCandidates({
      now: new Date('2026-05-21T00:00:00.000Z'),
      fileOlderThanHours: 24,
      ossObjectOlderThanHours: 24,
      limit: 100,
    });

    expect(result.created).toBe(0);
    expect(candidateRepository.save).not.toHaveBeenCalled();
  });

  it('continues scanning past old referenced files to find later orphan records', async () => {
    const referencedFile = createFile({ id: 21, path: 'family-chat/referenced.jpg' });
    const orphanFile = createFile({ id: 22, path: 'family-chat/orphan.jpg' });
    fileQueryBuilder.getMany
      .mockResolvedValueOnce([referencedFile])
      .mockResolvedValueOnce([orphanFile]);
    dataSource.query.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);

    const result = await service.scanCandidates({
      now: new Date('2026-05-21T00:00:00.000Z'),
      fileOlderThanHours: 24,
      ossObjectOlderThanHours: 24,
      limit: 1,
    });

    expect(result.created).toBe(1);
    expect(fileQueryBuilder.skip).toHaveBeenCalledWith(1);
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'db:22',
        objectKey: 'family-chat/orphan.jpg',
      }),
    );
  });

  it('records OSS objects without active file records as pending candidates', async () => {
    ossStrategy.listObjects.mockImplementation(async (prefix: string) => ({
      objects:
        prefix === 'family-chat/'
          ? [
              {
                key: 'family-chat/2026/05/20/orphan.jpg',
                lastModified: new Date('2026-05-20T00:00:00.000Z'),
                size: 2048,
              },
            ]
          : [],
      isTruncated: false,
      nextContinuationToken: null,
    }));

    const result = await service.scanCandidates({
      now: new Date('2026-05-21T00:00:00.000Z'),
      fileOlderThanHours: 24,
      ossObjectOlderThanHours: 12,
      limit: 100,
    });

    expect(result.created).toBe(1);
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'oss:family-chat/2026/05/20/orphan.jpg',
        source: FileCleanupCandidateSource.OSS_UNTRACKED,
        status: FileCleanupCandidateStatus.PENDING,
        fileId: null,
        objectKey: 'family-chat/2026/05/20/orphan.jpg',
        reason: 'oss_no_active_file_record',
      }),
    );
  });

  it('records default files prefix OSS objects without active file records', async () => {
    ossStrategy.listObjects.mockImplementation(async (prefix: string) => ({
      objects:
        prefix === 'files/'
          ? [
              {
                key: 'files/2026/05/20/draft.jpg',
                lastModified: new Date('2026-05-20T00:00:00.000Z'),
                size: 4096,
              },
            ]
          : [],
      isTruncated: false,
      nextContinuationToken: null,
    }));

    const result = await service.scanCandidates({
      now: new Date('2026-05-21T00:00:00.000Z'),
      fileOlderThanHours: 24,
      ossObjectOlderThanHours: 12,
      limit: 100,
    });

    expect(result.created).toBe(1);
    expect(ossStrategy.listObjects).toHaveBeenCalledWith(
      'files/',
      expect.objectContaining({ maxKeys: expect.any(Number) }),
    );
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'oss:files/2026/05/20/draft.jpg',
        source: FileCleanupCandidateSource.OSS_UNTRACKED,
        module: 'files',
        objectKey: 'files/2026/05/20/draft.jpg',
        reason: 'oss_no_active_file_record',
      }),
    );
  });

  it('records common file-center OSS prefixes without active file records', async () => {
    ossStrategy.listObjects.mockImplementation(async (prefix: string) => ({
      objects:
        prefix === 'document/'
          ? [
              {
                key: 'document/2026/05/20/manual.pdf',
                lastModified: new Date('2026-05-20T00:00:00.000Z'),
                size: 8192,
              },
            ]
          : [],
      isTruncated: false,
      nextContinuationToken: null,
    }));

    const result = await service.scanCandidates({
      now: new Date('2026-05-21T00:00:00.000Z'),
      fileOlderThanHours: 24,
      ossObjectOlderThanHours: 12,
      limit: 100,
    });

    expect(result.created).toBe(1);
    expect(ossStrategy.listObjects).toHaveBeenCalledWith(
      'document/',
      expect.objectContaining({ maxKeys: expect.any(Number) }),
    );
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'oss:document/2026/05/20/manual.pdf',
        module: 'document',
        objectKey: 'document/2026/05/20/manual.pdf',
      }),
    );
  });

  it('skips OSS objects that already have active file records in expanded prefixes', async () => {
    ossStrategy.listObjects.mockImplementation(async (prefix: string) => ({
      objects:
        prefix === 'document/'
          ? [
              {
                key: 'document/2026/05/20/kept.pdf',
                lastModified: new Date('2026-05-20T00:00:00.000Z'),
                size: 8192,
              },
            ]
          : [],
      isTruncated: false,
      nextContinuationToken: null,
    }));
    fileRepository.findOne.mockResolvedValueOnce(
      createFile({
        id: 33,
        path: 'document/2026/05/20/kept.pdf',
        module: 'document',
      }),
    );

    const result = await service.scanCandidates({
      now: new Date('2026-05-21T00:00:00.000Z'),
      fileOlderThanHours: 24,
      ossObjectOlderThanHours: 12,
      limit: 100,
    });

    expect(result.created).toBe(0);
    expect(candidateRepository.save).not.toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'oss:document/2026/05/20/kept.pdf',
      }),
    );
  });

  it('does not let ignored OSS candidates consume the scan limit', async () => {
    ossStrategy.listObjects.mockImplementation(async (prefix: string) => ({
      objects:
        prefix === 'files/'
          ? [
              {
                key: 'files/2026/05/20/ignored.jpg',
                lastModified: new Date('2026-05-20T00:00:00.000Z'),
                size: 1024,
              },
              {
                key: 'files/2026/05/20/new-orphan.jpg',
                lastModified: new Date('2026-05-20T00:00:00.000Z'),
                size: 2048,
              },
            ]
          : [],
      isTruncated: false,
      nextContinuationToken: null,
    }));
    candidateRepository.findOne.mockImplementation(
      async ({ where }: { where: { identity: string } }) =>
        where.identity === 'oss:files/2026/05/20/ignored.jpg'
          ? createCandidate({
              identity: 'oss:files/2026/05/20/ignored.jpg',
              source: FileCleanupCandidateSource.OSS_UNTRACKED,
              status: FileCleanupCandidateStatus.IGNORED,
              fileId: null,
              module: 'files',
              objectKey: 'files/2026/05/20/ignored.jpg',
            })
          : null,
    );

    const result = await service.scanCandidates({
      now: new Date('2026-05-21T00:00:00.000Z'),
      fileOlderThanHours: 24,
      ossObjectOlderThanHours: 12,
      limit: 1,
    });

    expect(result.created).toBe(1);
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'oss:files/2026/05/20/new-orphan.jpg',
        status: FileCleanupCandidateStatus.PENDING,
      }),
    );
    expect(candidateRepository.save).not.toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'oss:files/2026/05/20/ignored.jpg',
      }),
    );
  });

  it('skips OSS object reconciliation when OSS storage is unavailable', async () => {
    storageFactory.getAvailableStorageTypes.mockReturnValue([FileStorageType.LOCAL]);

    await service.scanCandidates({
      now: new Date('2026-05-21T00:00:00.000Z'),
      fileOlderThanHours: 24,
      ossObjectOlderThanHours: 12,
      limit: 100,
    });

    expect(storageFactory.getOssStrategy).not.toHaveBeenCalled();
  });

  it('does not reopen ignored candidates when they are seen again', async () => {
    candidateRepository.findOne.mockResolvedValueOnce(
      createCandidate({ status: FileCleanupCandidateStatus.IGNORED }),
    );
    fileQueryBuilder.getMany.mockResolvedValue([createFile()]);
    dataSource.query.mockResolvedValue([]);

    await service.scanCandidates({
      now: new Date('2026-05-21T00:00:00.000Z'),
      fileOlderThanHours: 24,
      ossObjectOlderThanHours: 24,
      limit: 100,
    });

    expect(candidateRepository.save).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: FileCleanupCandidateStatus.PENDING,
        identity: 'db:21',
      }),
    );
  });

  it('does not mark unseen candidates stale when scan stops at the configured limit', async () => {
    fileQueryBuilder.getMany.mockResolvedValue([createFile()]);
    dataSource.query.mockResolvedValue([]);
    candidateRepository.find.mockResolvedValue([
      createCandidate({ id: 99, identity: 'db:99', lastScanToken: 'previous-scan' }),
    ]);

    const result = await service.scanCandidates({
      now: new Date('2026-05-21T00:00:00.000Z'),
      fileOlderThanHours: 24,
      ossObjectOlderThanHours: 24,
      limit: 1,
    });

    expect(result.stale).toBe(0);
    expect(candidateRepository.find).not.toHaveBeenCalled();
  });

  it('marks candidates stale when they are no longer eligible before deletion', async () => {
    candidateRepository.find.mockResolvedValue([createCandidate()]);
    fileRepository.findOne.mockResolvedValue(createFile());
    dataSource.query.mockResolvedValue([{ id: 1 }]);

    const result = await service.deleteCandidates([1], 7);

    expect(result.stale).toBe(1);
    expect(fileService.remove).not.toHaveBeenCalled();
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: FileCleanupCandidateStatus.STALE }),
    );
  });

  it('deletes confirmed DB orphan candidates after a second safety check', async () => {
    candidateRepository.find.mockResolvedValue([createCandidate()]);
    fileRepository.findOne.mockResolvedValue(createFile());
    dataSource.query.mockResolvedValue([]);

    const result = await service.deleteCandidates([1], 7);

    expect(result.deleted).toBe(1);
    expect(fileService.remove).toHaveBeenCalledWith(21);
    expect(candidateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: FileCleanupCandidateStatus.DELETED,
        actedByUserId: 7,
      }),
    );
  });

  it('deletes confirmed untracked OSS candidates without touching FileService records', async () => {
    candidateRepository.find.mockResolvedValue([
      createCandidate({
        identity: 'oss:family-chat/2026/05/20/orphan.jpg',
        source: FileCleanupCandidateSource.OSS_UNTRACKED,
        fileId: null,
        objectKey: 'family-chat/2026/05/20/orphan.jpg',
        objectLastModified: new Date('2026-05-20T00:00:00.000Z'),
      }),
    ]);
    fileRepository.findOne.mockResolvedValue(null);
    ossStrategy.listObjects.mockResolvedValue({
      objects: [
        {
          key: 'family-chat/2026/05/20/orphan.jpg',
          lastModified: new Date('2026-05-20T00:00:00.000Z'),
          size: 2048,
        },
      ],
      isTruncated: false,
      nextContinuationToken: null,
    });

    const result = await service.deleteCandidates([1], 7);

    expect(result.deleted).toBe(1);
    expect(ossStrategy.delete).toHaveBeenCalledWith('family-chat/2026/05/20/orphan.jpg');
    expect(fileService.remove).not.toHaveBeenCalled();
  });

  it('deletes confirmed untracked OSS candidates under the default files prefix', async () => {
    candidateRepository.find.mockResolvedValue([
      createCandidate({
        identity: 'oss:files/2026/05/20/draft.jpg',
        source: FileCleanupCandidateSource.OSS_UNTRACKED,
        fileId: null,
        module: 'files',
        objectKey: 'files/2026/05/20/draft.jpg',
        objectLastModified: new Date('2026-05-20T00:00:00.000Z'),
      }),
    ]);
    fileRepository.findOne.mockResolvedValue(null);
    ossStrategy.listObjects.mockResolvedValue({
      objects: [
        {
          key: 'files/2026/05/20/draft.jpg',
          lastModified: new Date('2026-05-20T00:00:00.000Z'),
          size: 2048,
        },
      ],
      isTruncated: false,
      nextContinuationToken: null,
    });

    const result = await service.deleteCandidates([1], 7);

    expect(result.deleted).toBe(1);
    expect(ossStrategy.delete).toHaveBeenCalledWith('files/2026/05/20/draft.jpg');
    expect(fileService.remove).not.toHaveBeenCalled();
  });
});
