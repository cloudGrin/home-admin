import { ConfigService } from '@nestjs/config';
import OSS from 'ali-oss';
import { createMockConfigService } from '~/test-utils';
import { OssStorageStrategy } from './oss-storage.strategy';

const mockOssClient = {
  signatureUrlV4: jest.fn(),
  signatureUrl: jest.fn(),
};

jest.mock('ali-oss', () => jest.fn(() => mockOssClient));

describe('OssStorageStrategy', () => {
  let strategy: OssStorageStrategy;

  const createConfig = (ossOverrides: Record<string, unknown> = {}) =>
    createMockConfigService({
      file: {
        external: {
          oss: {
            enable: true,
            region: 'oss-cn-hangzhou',
            bucket: 'home-bucket',
            endpoint: 'oss-cn-hangzhou.aliyuncs.com',
            accessKeyId: 'access-key-id',
            accessKeySecret: 'access-key-secret',
            secure: true,
            ...ossOverrides,
          },
        },
      },
    }) as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOssClient.signatureUrlV4.mockResolvedValue('https://oss.example.com/upload-signature');
    mockOssClient.signatureUrl.mockReturnValue('https://oss.example.com/download-signature');

    (OSS as unknown as jest.Mock).mockImplementation(() => mockOssClient);

    strategy = new OssStorageStrategy(createConfig());
  });

  it('creates a signed upload URL constrained by content length and no-overwrite header', async () => {
    const result = await strategy.createSignedUploadUrl('avatar/test.jpg', 900, {
      contentType: 'image/jpeg',
      contentLength: 1024,
    });

    expect(result).toEqual({
      url: 'https://oss.example.com/upload-signature',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-oss-forbid-overwrite': 'true',
      },
    });
    expect(mockOssClient.signatureUrlV4).toHaveBeenCalledWith(
      'PUT',
      900,
      {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': '1024',
          'x-oss-forbid-overwrite': 'true',
        },
      },
      'avatar/test.jpg',
      ['content-length'],
    );
    expect(OSS).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'oss-cn-hangzhou',
        bucket: 'home-bucket',
      }),
    );
  });

  it('does not override content-type on signed download URLs', () => {
    const result = strategy.createSignedDownloadUrl('family/test.jpg', 900, {
      contentDisposition: 'inline; filename="test.jpg"',
      process: 'image/format,webp/quality,Q_100',
      cacheControl: 'private, max-age=120',
    });

    expect(result).toBe('https://oss.example.com/download-signature');
    expect(mockOssClient.signatureUrl).toHaveBeenCalledWith('family/test.jpg', {
      method: 'GET',
      expires: 900,
      process: 'image/format,webp/quality,Q_100',
      response: {
        'cache-control': 'private, max-age=120',
        'content-disposition': 'inline; filename="test.jpg"',
      },
    });
  });

  it('keeps signed uploads on the OSS endpoint and signs downloads with the configured CDN domain', async () => {
    jest.clearAllMocks();
    const sourceClient = {
      signatureUrlV4: jest.fn().mockResolvedValue('https://oss.example.com/upload-signature'),
      signatureUrl: jest.fn().mockReturnValue('https://oss.example.com/download-signature'),
    };
    const downloadClient = {
      signatureUrlV4: jest.fn(),
      signatureUrl: jest.fn().mockReturnValue('https://cdn.example.com/download-signature'),
    };
    (OSS as unknown as jest.Mock)
      .mockImplementationOnce(() => sourceClient)
      .mockImplementationOnce(() => downloadClient);
    const strategyWithCdn = new OssStorageStrategy(
      createConfig({
        baseUrl: 'https://cdn.example.com',
      }),
    );

    const upload = await strategyWithCdn.createSignedUploadUrl('family/test.jpg', 900, {
      contentType: 'image/jpeg',
      contentLength: 1024,
    });
    const download = strategyWithCdn.createSignedDownloadUrl('family/test.jpg', 900);

    expect(upload.url).toBe('https://oss.example.com/upload-signature');
    expect(download).toBe('https://cdn.example.com/download-signature');
    expect(sourceClient.signatureUrlV4).toHaveBeenCalled();
    expect(downloadClient.signatureUrl).toHaveBeenCalledWith('family/test.jpg', {
      method: 'GET',
      expires: 900,
      response: undefined,
    });
    expect(OSS).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        endpoint: 'oss-cn-hangzhou.aliyuncs.com',
        bucket: 'home-bucket',
      }),
    );
    expect(OSS).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        endpoint: 'https://cdn.example.com',
        bucket: 'home-bucket',
        cname: true,
      }),
    );
  });
});
