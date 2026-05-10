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

  beforeEach(() => {
    jest.clearAllMocks();
    mockOssClient.signatureUrlV4.mockResolvedValue('https://oss.example.com/upload-signature');
    mockOssClient.signatureUrl.mockReturnValue('https://oss.example.com/download-signature');

    strategy = new OssStorageStrategy(
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
            },
          },
        },
      }) as ConfigService,
    );
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
});
