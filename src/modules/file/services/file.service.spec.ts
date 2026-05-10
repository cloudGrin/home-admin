import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileService } from './file.service';
import { LoggerService } from '~/shared/logger/logger.service';
import { FileStorageFactory } from '../storage/storage.factory';
import { FileEntity, FileStorageType } from '../entities/file.entity';
import { BusinessException } from '~/common/exceptions/business.exception';
import { createMockRepository, createMockConfigService, createMockLogger } from '~/test-utils';

describe('FileService', () => {
  let service: FileService;
  let repository: jest.Mocked<Repository<FileEntity>>;
  let storageFactory: jest.Mocked<FileStorageFactory>;
  let _logger: jest.Mocked<LoggerService>;

  const createMockFile = (overrides?: Partial<Express.Multer.File>): Express.Multer.File => ({
    fieldname: 'file',
    originalname: 'test.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 1024 * 100,
    buffer: Buffer.from('test image data'),
    destination: '',
    filename: 'test.jpg',
    path: '',
    stream: undefined as any,
    ...overrides,
  });

  beforeEach(async () => {
    const mockRepository = createMockRepository<FileEntity>();
    const mockConfigService = createMockConfigService({
      jwt: {
        secret: 'test-secret-for-file-links',
      },
      file: {
        storage: FileStorageType.LOCAL,
        uploadDir: 'uploads',
        baseUrl: '/api/v1/files',
        maxSize: 50 * 1024 * 1024,
        allowedTypes: ['.jpg', '.jpeg', '.png', '.mp4', '.pdf', '.txt'],
        privateLinkTtlSeconds: 86400,
        ossDirectUploadTtlSeconds: 900,
      },
    });
    const mockStorageStrategy = {
      saveFile: jest.fn().mockResolvedValue({
        filename: 'test_123.jpg',
        path: 'uploads/2024/01/20/test_123.jpg',
        size: 1024 * 100,
        metadata: {},
      }),
      delete: jest.fn().mockResolvedValue(undefined),
      getStream: jest.fn().mockReturnValue({} as any),
      isEnabled: jest.fn().mockReturnValue(true),
      buildObjectKey: jest.fn().mockReturnValue('avatar/2024/01/20/test_123.jpg'),
      buildPublicUrl: jest.fn().mockReturnValue('https://cdn.example.com/test_123.jpg'),
      createSignedUploadUrl: jest.fn().mockResolvedValue({
        url: 'https://oss.example.com/upload-signature',
        headers: {
          'Content-Type': 'image/jpeg',
          'x-oss-forbid-overwrite': 'true',
        },
      }),
      createSignedDownloadUrl: jest
        .fn()
        .mockReturnValue('https://oss.example.com/download-signature'),
      headObject: jest.fn().mockResolvedValue({
        contentLength: 1024 * 100,
        contentType: 'image/jpeg',
        etag: 'etag-1',
      }),
    };
    const mockStorageFactory = {
      getStrategy: jest.fn().mockReturnValue(mockStorageStrategy),
      getOssStrategy: jest.fn().mockReturnValue(mockStorageStrategy),
      getAvailableStorageTypes: jest
        .fn()
        .mockReturnValue([FileStorageType.LOCAL, FileStorageType.OSS]),
      normalizeDefaultStorage: jest.fn().mockReturnValue(FileStorageType.LOCAL),
    } as unknown as jest.Mocked<FileStorageFactory>;
    const mockLogger = createMockLogger();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        { provide: getRepositoryToken(FileEntity), useValue: mockRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: FileStorageFactory, useValue: mockStorageFactory },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get(FileService);
    repository = module.get(getRepositoryToken(FileEntity));
    storageFactory = module.get(FileStorageFactory);
    _logger = module.get(LoggerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('应该正确初始化服务', () => {
    expect(service).toBeDefined();
  });

  describe('upload', () => {
    it('应该成功上传文件', async () => {
      const file = createMockFile();
      const entity = { id: 1, originalName: file.originalname } as FileEntity;
      repository.create.mockReturnValue(entity);
      repository.save.mockResolvedValue(entity);

      const result = await service.upload(file, { module: 'avatar', isPublic: true }, 1);

      expect(result).toEqual(entity);
      expect(repository.create).toHaveBeenCalled();
      expect(repository.create.mock.calls[0][0]).not.toHaveProperty('status');
      expect(repository.save).toHaveBeenCalledWith(entity);
    });

    it('accepts mp4 uploads with octet-stream MIME from mobile browsers', async () => {
      const file = createMockFile({
        originalname: 'family-video.mp4',
        mimetype: 'application/octet-stream',
      });
      const entity = { id: 2, originalName: file.originalname } as FileEntity;
      repository.create.mockReturnValue(entity);
      repository.save.mockResolvedValue(entity);

      await service.upload(file, { module: 'family-chat', isPublic: false }, 1);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          originalName: 'family-video.mp4',
          mimeType: 'video/mp4',
          category: 'video',
        }),
      );
    });

    it('stores uploads without a selected module under the default files prefix', async () => {
      const file = createMockFile({ originalname: 'plain.jpg' });
      const entity = { id: 12, originalName: file.originalname } as FileEntity;
      const storage = storageFactory.getStrategy(FileStorageType.LOCAL) as any;
      (storage.saveFile as jest.Mock).mockClear();
      repository.create.mockReturnValue(entity);
      repository.save.mockResolvedValue(entity);

      await service.upload(file, { isPublic: false }, 1);

      expect(storage.saveFile).toHaveBeenCalledWith(
        file.buffer,
        expect.objectContaining({
          relativePath: expect.stringMatching(/^files\/\d{4}\/\d{2}\/\d{2}$/),
        }),
      );
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          module: undefined,
        }),
      );
    });

    it('allows trusted callers to override the configured extension whitelist', async () => {
      (service as any).allowedTypes = ['.jpg', '.jpeg', '.png', '.pdf', '.txt', '.zip'];
      const file = createMockFile({
        originalname: 'family-video.mp4',
        mimetype: 'application/octet-stream',
      });
      const entity = { id: 3, originalName: file.originalname } as FileEntity;
      repository.create.mockReturnValue(entity);
      repository.save.mockResolvedValue(entity);

      await service.upload(
        file,
        {
          module: 'family-chat',
          isPublic: false,
          allowedTypes: ['.mp4'],
          maxSize: 500 * 1024 * 1024,
        },
        1,
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          originalName: 'family-video.mp4',
          mimeType: 'video/mp4',
          category: 'video',
        }),
      );
    });

    it('当没有提供文件时应该抛出异常', async () => {
      await expect(service.upload(null as any, {}, 1)).rejects.toThrow(BusinessException);
    });

    it('当文件类型不允许时应该抛出异常', async () => {
      await expect(
        service.upload(
          createMockFile({
            originalname: 'malicious.exe',
            mimetype: 'application/x-msdownload',
          }),
          {},
          1,
        ),
      ).rejects.toThrow(BusinessException);
    });

    it('数据库保存失败时回滚已写入的存储文件', async () => {
      const file = createMockFile();
      const entity = { id: 1, originalName: file.originalname } as FileEntity;
      const storage = storageFactory.getStrategy(FileStorageType.LOCAL);

      repository.create.mockReturnValue(entity);
      repository.save.mockRejectedValue(new Error('db unavailable'));

      await expect(service.upload(file, { module: 'avatar' }, 1)).rejects.toThrow('db unavailable');
      expect(storage.delete).toHaveBeenCalledWith('uploads/2024/01/20/test_123.jpg');
    });

    it('使用调用方指定的存储类型，而不是全局默认存储', async () => {
      const file = createMockFile();
      const entity = {
        id: 1,
        originalName: file.originalname,
        storage: FileStorageType.OSS,
      } as FileEntity;
      repository.create.mockReturnValue(entity);
      repository.save.mockResolvedValue(entity);

      await service.upload(file, { module: 'avatar', storage: FileStorageType.OSS }, 1);

      expect(storageFactory.getStrategy).toHaveBeenCalledWith(FileStorageType.OSS);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          storage: FileStorageType.OSS,
        }),
      );
    });

    it('私有 OSS 文件不保存公开访问 URL', async () => {
      const file = createMockFile();
      const storage = storageFactory.getStrategy(FileStorageType.OSS);
      (storage.saveFile as jest.Mock).mockResolvedValueOnce({
        filename: 'test_123.jpg',
        path: 'avatar/2024/01/20/test_123.jpg',
        size: file.size,
        url: 'https://cdn.example.com/test_123.jpg',
        metadata: {},
      });
      const entity = { id: 1, originalName: file.originalname } as FileEntity;
      repository.create.mockReturnValue(entity);
      repository.save.mockResolvedValue(entity);

      await service.upload(
        file,
        { module: 'avatar', storage: FileStorageType.OSS, isPublic: false },
        1,
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isPublic: false,
          url: undefined,
        }),
      );
    });

    it('公开 OSS 文件保存后端公开下载 URL，而不是私有 bucket 对象直链', async () => {
      const file = createMockFile();
      const storage = storageFactory.getStrategy(FileStorageType.OSS);
      (storage.saveFile as jest.Mock).mockResolvedValueOnce({
        filename: 'test_123.jpg',
        path: 'user-avatar/2026/05/09/test_123.jpg',
        size: file.size,
        url: 'https://oss.example.com/user-avatar/2026/05/09/test_123.jpg',
        metadata: {},
      });
      const entity = {
        id: 9,
        originalName: file.originalname,
        storage: FileStorageType.OSS,
        isPublic: true,
      } as FileEntity;
      repository.create.mockReturnValue(entity);
      repository.save.mockResolvedValue(entity);

      const result = await service.upload(
        file,
        { module: 'user-avatar', storage: FileStorageType.OSS, isPublic: true },
        1,
      );

      expect(result.url).toBe('/api/v1/files/9/public');
      expect(repository.update).toHaveBeenCalledWith(9, { url: '/api/v1/files/9/public' });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: undefined,
          isPublic: true,
        }),
      );
    });
  });

  describe('getStorageOptions', () => {
    it('返回当前可用的存储选项和默认存储', () => {
      expect(service.getStorageOptions()).toEqual({
        defaultStorage: FileStorageType.LOCAL,
        options: [
          { value: FileStorageType.LOCAL, label: '本地存储' },
          { value: FileStorageType.OSS, label: '阿里云 OSS' },
        ],
      });
    });
  });

  describe('createDirectUpload', () => {
    it('allows trusted callers to override the direct upload max size for OSS-only flows', async () => {
      const largeSize = 300 * 1024 * 1024;

      await expect(
        (service as any).createDirectUpload(
          {
            originalName: 'family-video.mp4',
            mimeType: 'video/mp4',
            size: largeSize,
            module: 'family-chat',
            isPublic: false,
          },
          1,
          { maxSize: 500 * 1024 * 1024 },
        ),
      ).resolves.toEqual(expect.objectContaining({ method: 'PUT' }));

      expect(storageFactory.getOssStrategy().createSignedUploadUrl).toHaveBeenCalledWith(
        'avatar/2024/01/20/test_123.jpg',
        900,
        expect.objectContaining({
          contentType: 'video/mp4',
          contentLength: largeSize,
        }),
      );
    });

    it('infers mp4 content type for direct uploads with octet-stream MIME', async () => {
      (service as any).allowedTypes = ['.jpg', '.jpeg', '.png', '.pdf', '.txt', '.zip'];

      await expect(
        service.createDirectUpload(
          {
            originalName: 'family-video.mp4',
            mimeType: 'application/octet-stream',
            size: 12 * 1024 * 1024,
            module: 'family-chat',
            isPublic: false,
          },
          1,
          { maxSize: 500 * 1024 * 1024, allowedTypes: ['.mp4'] },
        ),
      ).resolves.toEqual(expect.objectContaining({ method: 'PUT' }));

      expect(storageFactory.getOssStrategy().createSignedUploadUrl).toHaveBeenCalledWith(
        'avatar/2024/01/20/test_123.jpg',
        900,
        expect.objectContaining({
          contentType: 'video/mp4',
          contentLength: 12 * 1024 * 1024,
        }),
      );
    });

    it('uses the default files prefix for direct uploads without a selected module', async () => {
      await service.createDirectUpload(
        {
          originalName: 'plain.jpg',
          mimeType: 'image/jpeg',
          size: 1024 * 100,
          isPublic: false,
        },
        1,
      );

      expect(storageFactory.getOssStrategy().buildObjectKey).toHaveBeenCalledWith(
        expect.objectContaining({
          relativePath: expect.stringMatching(/^files\/\d{4}\/\d{2}\/\d{2}$/),
        }),
      );
    });

    it('为 OSS 直传创建签名 PUT URL 和上传令牌', async () => {
      const result = await service.createDirectUpload(
        {
          originalName: 'test.jpg',
          mimeType: 'image/jpeg',
          size: 1024 * 100,
          module: 'avatar',
          isPublic: true,
          tags: 'profile',
        },
        1,
      );

      expect(storageFactory.getOssStrategy).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          method: 'PUT',
          uploadUrl: 'https://oss.example.com/upload-signature',
          headers: {
            'Content-Type': 'image/jpeg',
            'x-oss-forbid-overwrite': 'true',
          },
        }),
      );
      expect(storageFactory.getOssStrategy().createSignedUploadUrl).toHaveBeenCalledWith(
        'avatar/2024/01/20/test_123.jpg',
        900,
        {
          contentType: 'image/jpeg',
          contentLength: 1024 * 100,
        },
      );
      expect(result.uploadToken).toEqual(expect.any(String));
      expect(result.expiresAt).toEqual(expect.any(String));
    });

    it('完成 OSS 直传后校验对象大小并写入文件记录', async () => {
      const initiate = await service.createDirectUpload(
        {
          originalName: 'test.jpg',
          mimeType: 'image/jpeg',
          size: 1024 * 100,
          module: 'avatar',
          isPublic: false,
        },
        1,
      );
      const entity = {
        id: 1,
        originalName: 'test.jpg',
        storage: FileStorageType.OSS,
      } as FileEntity;
      repository.create.mockReturnValue(entity);
      repository.save.mockResolvedValue(entity);

      const result = await service.completeDirectUpload({ uploadToken: initiate.uploadToken });

      expect(result).toBe(entity);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          originalName: 'test.jpg',
          storage: FileStorageType.OSS,
          isPublic: false,
          url: undefined,
          uploaderId: 1,
          metadata: expect.objectContaining({ directUpload: true, etag: 'etag-1' }),
        }),
      );
    });

    it('公开 OSS 直传完成后保存后端公开下载 URL，而不是私有 bucket 对象直链', async () => {
      const initiate = await service.createDirectUpload(
        {
          originalName: 'avatar.jpg',
          mimeType: 'image/jpeg',
          size: 1024 * 100,
          module: 'user-avatar',
          isPublic: true,
        },
        1,
      );
      const entity = {
        id: 10,
        originalName: 'avatar.jpg',
        storage: FileStorageType.OSS,
        isPublic: true,
      } as FileEntity;
      repository.create.mockReturnValue(entity);
      repository.save.mockResolvedValue(entity);

      const result = await service.completeDirectUpload({ uploadToken: initiate.uploadToken });

      expect(result.url).toBe('/api/v1/files/10/public');
      expect(repository.update).toHaveBeenCalledWith(10, { url: '/api/v1/files/10/public' });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: undefined,
          isPublic: true,
        }),
      );
    });

    it('stores inferred mp4 MIME when OSS reports octet-stream metadata', async () => {
      const storage = storageFactory.getOssStrategy();
      (storage.headObject as jest.Mock).mockResolvedValueOnce({
        contentLength: 12 * 1024 * 1024,
        contentType: 'application/octet-stream',
        etag: 'etag-video',
      });
      const initiate = await service.createDirectUpload(
        {
          originalName: 'family-video.mp4',
          mimeType: 'application/octet-stream',
          size: 12 * 1024 * 1024,
          module: 'family-chat',
          isPublic: false,
        },
        1,
        { maxSize: 500 * 1024 * 1024 },
      );
      const entity = {
        id: 2,
        originalName: 'family-video.mp4',
        storage: FileStorageType.OSS,
      } as FileEntity;
      repository.create.mockReturnValue(entity);
      repository.save.mockResolvedValue(entity);

      await service.completeDirectUpload({ uploadToken: initiate.uploadToken });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          originalName: 'family-video.mp4',
          mimeType: 'video/mp4',
          category: 'video',
        }),
      );
    });

    it('重复完成同一个 OSS 直传令牌时返回已有记录，避免创建重复文件记录', async () => {
      const initiate = await service.createDirectUpload(
        {
          originalName: 'test.jpg',
          mimeType: 'image/jpeg',
          size: 1024 * 100,
          module: 'avatar',
          isPublic: false,
        },
        1,
      );
      const existing = {
        id: 9,
        originalName: 'test.jpg',
        path: 'avatar/2024/01/20/test_123.jpg',
        storage: FileStorageType.OSS,
      } as FileEntity;
      repository.findOne.mockResolvedValue(existing);

      const result = await service.completeDirectUpload({ uploadToken: initiate.uploadToken });

      expect(result).toBe(existing);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: {
          path: 'avatar/2024/01/20/test_123.jpg',
          storage: FileStorageType.OSS,
        },
      });
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
      expect(storageFactory.getOssStrategy().headObject).not.toHaveBeenCalled();
    });
  });

  describe('createAccessLink', () => {
    it('为有权限的私有文件创建临时访问链接', async () => {
      repository.findOne.mockResolvedValue({
        id: 3,
        originalName: 'secret.txt',
        isPublic: false,
        uploaderId: 1,
      } as FileEntity);

      const result = await service.createAccessLink(3, { id: 1 }, { disposition: 'inline' });

      expect(result.url).toContain('/api/v1/files/3/access?token=');
      expect(result.expiresAt).toEqual(expect.any(String));
    });

    it('解析 OSS 私有链接时返回短期 OSS 下载地址', async () => {
      repository.findOne.mockResolvedValue({
        id: 3,
        originalName: 'secret.txt',
        path: 'private/secret.txt',
        mimeType: 'text/plain',
        storage: FileStorageType.OSS,
        isPublic: false,
        uploaderId: 1,
      } as FileEntity);
      const link = await service.createAccessLink(3, { id: 1 }, { disposition: 'attachment' });

      const result = await service.resolveAccessLink(3, link.token);

      expect(storageFactory.getOssStrategy).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          file: expect.objectContaining({ id: 3 }),
          redirectUrl: 'https://oss.example.com/download-signature',
          disposition: 'attachment',
        }),
      );
    });

    it('解析受信任图片链接时把 OSS 图片处理参数带入签名地址', async () => {
      repository.findOne.mockResolvedValue({
        id: 5,
        originalName: 'family.jpg',
        path: 'family-circle/2026/05/04/family.jpg',
        mimeType: 'image/jpeg',
        storage: FileStorageType.OSS,
        isPublic: false,
        uploaderId: 1,
      } as FileEntity);
      const link = await service.createTrustedAccessLink(5, {
        disposition: 'inline',
        process: 'image/format,webp/quality,Q_100',
      });

      await service.resolveAccessLink(5, link.token);

      expect(storageFactory.getOssStrategy().createSignedDownloadUrl).toHaveBeenCalledWith(
        'family-circle/2026/05/04/family.jpg',
        expect.any(Number),
        expect.objectContaining({
          process: 'image/format,webp/quality,Q_100',
        }),
      );
    });

    it('keeps trusted access links stable inside a private cache window', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-10T00:00:00.000Z'));

      const first = await service.createTrustedAccessLink(5, {
        disposition: 'inline',
        process: 'image/format,webp/quality,Q_100',
        cacheMaxAgeSeconds: 30 * 24 * 60 * 60,
      });

      jest.setSystemTime(new Date('2026-05-15T00:00:00.000Z'));

      const second = await service.createTrustedAccessLink(5, {
        disposition: 'inline',
        process: 'image/format,webp/quality,Q_100',
        cacheMaxAgeSeconds: 30 * 24 * 60 * 60,
      });

      expect(second.url).toBe(first.url);
      expect(second.expiresAt).toBe(first.expiresAt);
      expect(first.cacheMaxAgeSeconds).toBe(30 * 24 * 60 * 60);
    });

    it('exposes remaining private cache max-age when resolving cached trusted links', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-10T00:00:00.000Z'));
      repository.findOne.mockResolvedValue({
        id: 5,
        originalName: 'family.jpg',
        path: 'family-circle/2026/05/04/family.jpg',
        mimeType: 'image/jpeg',
        storage: FileStorageType.LOCAL,
        isPublic: false,
        uploaderId: 1,
      } as FileEntity);
      const link = await service.createTrustedAccessLink(5, {
        disposition: 'inline',
        cacheMaxAgeSeconds: 30 * 24 * 60 * 60,
      });

      jest.setSystemTime(new Date('2026-05-10T00:00:10.000Z'));

      const result = await service.resolveAccessLink(5, link.token);

      expect(result.cacheMaxAgeSeconds).toBeGreaterThan(0);
      expect(result.cacheMaxAgeSeconds).toBeLessThanOrEqual(30 * 24 * 60 * 60);
    });

    it('matches OSS signed download TTL to cached trusted link lifetime', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-10T00:00:00.000Z'));
      repository.findOne.mockResolvedValue({
        id: 5,
        originalName: 'family.jpg',
        path: 'family-circle/2026/05/04/family.jpg',
        mimeType: 'image/jpeg',
        storage: FileStorageType.OSS,
        isPublic: false,
        uploaderId: 1,
      } as FileEntity);
      const link = await service.createTrustedAccessLink(5, {
        disposition: 'inline',
        cacheMaxAgeSeconds: 30 * 24 * 60 * 60,
      });

      await service.resolveAccessLink(5, link.token);

      expect(storageFactory.getOssStrategy().createSignedDownloadUrl).toHaveBeenCalledWith(
        'family-circle/2026/05/04/family.jpg',
        expect.any(Number),
        expect.objectContaining({
          cacheControl: expect.stringMatching(/^private, max-age=\d+$/),
        }),
      );
      expect(
        storageFactory.getOssStrategy().createSignedDownloadUrl.mock.calls.at(-1)?.[1],
      ).toBeGreaterThan(300);
    });
  });

  describe('findFiles', () => {
    it('应该成功分页查询文件', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      repository.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.findFiles({ page: 1, limit: 10 });

      expect(result.meta.currentPage).toBe(1);
      expect(repository.createQueryBuilder).toHaveBeenCalledWith('file');
    });

    it('loads uploader information for list display', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      repository.createQueryBuilder.mockReturnValue(qb as any);

      await service.findFiles({ page: 1, limit: 10 });

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('file.uploader', 'uploader');
    });

    it('ignores unsupported sort fields and falls back to createdAt ordering', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      repository.createQueryBuilder.mockReturnValue(qb as any);

      await service.findFiles({ page: 1, limit: 10, sort: 'id;DROP TABLE files' } as any);

      expect(qb.orderBy).toHaveBeenCalledWith('file.createdAt', 'DESC');
      expect(qb.orderBy).not.toHaveBeenCalledWith('file.id;DROP TABLE files', expect.anything());
    });
  });

  describe('findById', () => {
    it('应该成功查询文件详情', async () => {
      const file = { id: 1, originalName: 'test.jpg' } as FileEntity;
      repository.findOne.mockResolvedValue(file);

      const result = await service.findById(1);

      expect(result).toEqual(file);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });

  describe('remove', () => {
    it('应该成功删除文件', async () => {
      const file = {
        id: 1,
        path: 'uploads/test.jpg',
        storage: FileStorageType.LOCAL,
      } as FileEntity;
      repository.findOne.mockResolvedValue(file);
      repository.softDelete.mockResolvedValue({ affected: 1 } as any);

      await service.remove(1);

      expect(repository.softDelete).toHaveBeenCalledWith(1);
      expect(storageFactory.getStrategy(FileStorageType.LOCAL).delete).toHaveBeenCalledWith(
        file.path,
      );
    });

    it('物理删除失败时恢复软删除记录，避免数据库指向丢失文件', async () => {
      const file = {
        id: 1,
        path: 'uploads/test.jpg',
        storage: FileStorageType.LOCAL,
      } as FileEntity;
      const storage = storageFactory.getStrategy(FileStorageType.LOCAL);
      (repository as any).restore = jest.fn().mockResolvedValue({ affected: 1 });
      repository.findOne.mockResolvedValue(file);
      repository.softDelete.mockResolvedValue({ affected: 1 } as any);
      (storage.delete as jest.Mock).mockRejectedValue(new Error('storage unavailable'));

      await expect(service.remove(1)).rejects.toThrow('storage unavailable');

      expect(repository.softDelete).toHaveBeenCalledWith(1);
      expect((repository as any).restore).toHaveBeenCalledWith(1);
    });
  });
});
