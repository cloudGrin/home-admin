import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { posix } from 'path';
import OSS from 'ali-oss';
import {
  FileStorageStrategy,
  FileStorageSaveOptions,
  StoredFileMetadata,
} from './file-storage.interface';

interface OssConfig {
  enable: boolean;
  region?: string;
  bucket?: string;
  endpoint?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
  secure?: boolean;
  baseUrl?: string;
}

export interface OssObjectMetadata {
  contentLength: number;
  contentType?: string;
  etag?: string;
}

export interface OssSignedUploadOptions {
  contentType: string;
  contentLength: number;
}

export interface OssSignedUploadCredentials {
  url: string;
  headers: Record<string, string>;
}

type OssClientWithSignedUrlV4 = OSS & {
  signatureUrlV4: (
    method: string,
    expires: number,
    request: { headers: Record<string, string>; queries?: Record<string, string> },
    objectName: string,
    additionalHeaders?: string[],
  ) => Promise<string>;
};

const OSS_FORBID_OVERWRITE_HEADER = 'x-oss-forbid-overwrite';

@Injectable()
export class OssStorageStrategy implements FileStorageStrategy {
  private readonly logger = new Logger(OssStorageStrategy.name);
  private readonly config: OssConfig;
  private client?: OSS;
  private downloadClient?: OSS;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<OssConfig>('file.external.oss', {
      enable: false,
    });

    if (this.isEnabled()) {
      this.client = this.createClient(this.config.endpoint);
      if (this.config.baseUrl) {
        this.downloadClient = this.createClient(this.config.baseUrl, true);
      }
    }
  }

  isEnabled(): boolean {
    return !!(
      this.config.enable &&
      this.config.bucket &&
      this.config.accessKeyId &&
      this.config.accessKeySecret
    );
  }

  async saveFile(buffer: Buffer, options: FileStorageSaveOptions): Promise<StoredFileMetadata> {
    const client = this.ensureClient();
    const key = this.buildObjectKey(options);

    const result = await client.put(key, buffer);

    return this.buildMetadata(key, buffer.length, options.metadata, result.url);
  }

  buildObjectKey(options: FileStorageSaveOptions): string {
    const parts: string[] = [];
    if (options.relativePath) {
      parts.push(options.relativePath.replace(/\\/g, '/'));
    }
    parts.push(options.filename);
    return posix.join(...parts);
  }

  buildPublicUrl(key: string): string | undefined {
    return this.buildUrl(key);
  }

  async createSignedUploadUrl(
    key: string,
    expires: number,
    options: OssSignedUploadOptions,
  ): Promise<OssSignedUploadCredentials> {
    const client = this.ensureClient();
    const contentLength = String(options.contentLength);
    const signedHeaders = {
      'Content-Type': options.contentType,
      'Content-Length': contentLength,
      [OSS_FORBID_OVERWRITE_HEADER]: 'true',
    };
    const url = await (client as OssClientWithSignedUrlV4).signatureUrlV4(
      'PUT',
      expires,
      { headers: signedHeaders },
      key,
      ['content-length'],
    );

    return {
      url,
      headers: {
        'Content-Type': options.contentType,
        [OSS_FORBID_OVERWRITE_HEADER]: 'true',
      },
    };
  }

  createSignedDownloadUrl(
    key: string,
    expires: number,
    response?: {
      contentDisposition?: string;
      process?: string;
      cacheControl?: string;
    },
  ): string {
    const client = this.ensureDownloadClient();
    return client.signatureUrl(key, {
      method: 'GET',
      expires,
      ...(response?.process ? { process: response.process } : {}),
      response: response
        ? {
            ...(response.contentDisposition
              ? { 'content-disposition': response.contentDisposition }
              : {}),
            ...(response.cacheControl ? { 'cache-control': response.cacheControl } : {}),
          }
        : undefined,
    });
  }

  async headObject(key: string): Promise<OssObjectMetadata> {
    const client = this.ensureClient();
    const result = await client.head(key);
    const headers = result.res?.headers || {};
    const rawLength = headers['content-length'];
    const contentLength =
      typeof rawLength === 'string' ? Number(rawLength) : Number(rawLength || 0);

    return {
      contentLength: Number.isFinite(contentLength) ? contentLength : 0,
      contentType: headers['content-type'],
      etag: headers.etag,
    };
  }

  async delete(path: string): Promise<void> {
    const client = this.ensureClient();
    try {
      await client.delete(path);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        return;
      }
      throw error;
    }
  }

  async getStream(path: string): Promise<NodeJS.ReadableStream> {
    const client = this.ensureClient();
    const result = await client.getStream(path);
    return result.stream;
  }

  private createClient(endpoint?: string, cname = false): OSS {
    return new OSS({
      region: this.config.region,
      bucket: this.config.bucket,
      endpoint: endpoint?.replace(/\/$/, ''),
      cname,
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      secure: this.config.secure !== false,
    });
  }

  private ensureClient(): OSS {
    if (!this.isEnabled() || !this.client) {
      throw new Error('OSS storage is not configured properly');
    }
    return this.client;
  }

  private ensureDownloadClient(): OSS {
    if (!this.isEnabled()) {
      throw new Error('OSS storage is not configured properly');
    }
    return this.downloadClient || this.ensureClient();
  }

  private buildMetadata(
    key: string,
    size: number,
    metadata?: Record<string, unknown>,
    url?: string,
  ): StoredFileMetadata {
    const objectUrl = this.buildUrl(key, url);
    this.logger.debug(`OSS saved object key=${key}, url=${objectUrl}`);
    return {
      filename: posix.basename(key),
      path: key,
      size,
      url: objectUrl,
      metadata,
    };
  }

  private buildUrl(key: string, fallbackUrl?: string): string | undefined {
    if (this.config.baseUrl) {
      const normalizedBase = this.config.baseUrl.replace(/\/$/, '');
      return `${normalizedBase}/${key}`;
    }
    if (fallbackUrl) {
      return fallbackUrl;
    }
    const client = this.client;
    if (client) {
      return client.generateObjectUrl(key);
    }
    return undefined;
  }
}
