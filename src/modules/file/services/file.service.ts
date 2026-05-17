import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import dayjs from 'dayjs';
import { LoggerService } from '~/shared/logger/logger.service';
import { BusinessException } from '~/common/exceptions/business.exception';
import { FileUtil } from '~/common/utils';
import { PaginationOptions, PaginationResult } from '~/common/types/pagination.types';
import { DEFAULT_FILE_MAX_SIZE } from '~/config/constants';
import { FileEntity, FileStorageType } from '../entities/file.entity';
import { UploadFileDto } from '../dto/upload-file.dto';
import { QueryFileDto } from '../dto/query-file.dto';
import { CompleteDirectUploadDto, CreateDirectUploadDto } from '../dto/direct-upload.dto';
import { CreateFileAccessLinkDto, FileAccessDisposition } from '../dto/file-access-link.dto';
import { OSS_IMAGE_DEFAULT_INLINE_PROCESS } from '../image-process.constants';
import { FileStorageFactory } from '../storage/storage.factory';
import { FileStorageStrategy } from '../storage/file-storage.interface';

interface UserWithRoles {
  id: number;
  roles?: Array<{ code: string } | string>;
}

interface FileQueryOptions {
  keyword?: string;
  storage?: FileStorageType;
  category?: string;
  module?: string;
  isPublic?: boolean;
}

export interface StorageOptionItem {
  value: FileStorageType;
  label: string;
}

export interface StorageOptionsResponse {
  defaultStorage: FileStorageType;
  options: StorageOptionItem[];
}

interface BaseTokenPayload {
  type: 'oss-upload' | 'file-access';
  exp: number;
}

interface DirectUploadTokenPayload extends BaseTokenPayload {
  type: 'oss-upload';
  key: string;
  originalName: string;
  filename: string;
  size: number;
  mimeType: string;
  category: string;
  module?: string;
  tags?: string;
  isPublic: boolean;
  remark?: string;
  uploaderId?: number;
}

interface FileAccessTokenPayload extends BaseTokenPayload {
  type: 'file-access';
  fileId: number;
  disposition: FileAccessDisposition;
  process?: string;
  cacheMaxAgeSeconds?: number;
}

interface FileValidationOptions {
  maxSize?: number;
  allowedTypes?: string[];
}

interface TrustedAccessLinkOptions {
  process?: string;
  cacheMaxAgeSeconds?: number;
  file?: Pick<FileEntity, 'storage' | 'category' | 'mimeType' | 'originalName'>;
}

export interface PublicDownloadResult {
  file: FileEntity;
  stream?: NodeJS.ReadableStream;
  redirectUrl?: string;
  cacheMaxAgeSeconds?: number;
}

export interface FileDownloadResult {
  file: FileEntity;
  disposition: FileAccessDisposition;
  stream?: NodeJS.ReadableStream;
  redirectUrl?: string;
  cacheMaxAgeSeconds?: number;
}

const FILE_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'originalName', 'filename', 'size']);
const DEFAULT_FILE_MODULE = 'files';
const PUBLIC_OSS_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const STORAGE_OPTION_LABELS: Record<FileStorageType, string> = {
  [FileStorageType.LOCAL]: '本地存储',
  [FileStorageType.OSS]: '阿里云 OSS',
};

@Injectable()
export class FileService {
  private readonly storageType: FileStorageType;
  private readonly maxFileSize: number;
  private readonly allowedTypes: string[];
  private readonly publicFileBaseUrl: string;
  private readonly privateLinkTtlSeconds: number;
  private readonly ossDirectUploadTtlSeconds: number;
  private readonly signedOssDownloadTtlSeconds = 300;

  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    private readonly configService: ConfigService,
    private readonly storageFactory: FileStorageFactory,
    private readonly logger: LoggerService,
  ) {
    this.storageType = this.configService.get<FileStorageType>(
      'file.storage',
      FileStorageType.LOCAL,
    );
    this.publicFileBaseUrl = this.configService.get<string>('file.baseUrl', '/api/v1/files');
    this.maxFileSize = this.getNumber('file.maxSize', DEFAULT_FILE_MAX_SIZE);
    this.privateLinkTtlSeconds = this.getNumber('file.privateLinkTtlSeconds', 86400);
    this.ossDirectUploadTtlSeconds = this.getNumber('file.ossDirectUploadTtlSeconds', 900);
    this.allowedTypes = this.normalizeAllowedTypes(
      this.configService.get<string | string[]>('file.allowedTypes', [
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.webp',
        '.heic',
        '.heif',
        '.mp4',
        '.mov',
        '.webm',
        '.mkv',
        '.avi',
        '.wmv',
        '.pdf',
        '.doc',
        '.docx',
        '.ppt',
        '.pptx',
        '.txt',
        '.zip',
      ]),
    );
  }

  /**
   * 直接上传文件
   */
  async upload(
    file: Express.Multer.File,
    options: UploadFileDto & FileValidationOptions,
    uploaderId?: number,
  ): Promise<FileEntity> {
    if (!file) {
      throw BusinessException.validationFailed('请选择要上传的文件');
    }

    this.validateFile(file, options);
    this.logger?.debug(
      `[FileUpload] Receive file "${file.originalname}" (${FileUtil.formatSize(file.size)})`,
    );

    const targetStorage = options.storage ?? this.storageType;
    const storage = this.getStorageStrategy(targetStorage);
    const relativePath = this.buildRelativePath(options.module);
    const uniqueFilename = FileUtil.generateUniqueFilename(file.originalname);

    const category = FileUtil.getFileCategory(file.originalname);
    const mimeType = this.getEffectiveMimeType(file.originalname, file.mimetype);
    const hash = this.computeHash(file.buffer!);

    let stored: Awaited<ReturnType<FileStorageStrategy['saveFile']>> | undefined;
    let entity: FileEntity | undefined;

    try {
      stored = await storage.saveFile(file.buffer!, {
        filename: uniqueFilename,
        relativePath,
        isPublic: options.isPublic ?? false,
      });
      this.logger?.log(
        `[FileUpload] Stored file "${stored.filename}" via ${targetStorage} (path=${stored.path})`,
      );

      entity = await this.fileRepository.save(
        this.fileRepository.create({
          originalName: file.originalname,
          filename: stored.filename,
          path: stored.path,
          url: undefined,
          mimeType,
          size: stored.size,
          category,
          storage: targetStorage,
          hash,
          module: options.module,
          tags: options.tags,
          isPublic: options.isPublic ?? false,
          remark: options.remark,
          metadata: stored.metadata,
          uploaderId,
        }),
      );

      await this.ensurePublicDownloadUrl(entity);
    } catch (error) {
      let recordRollbackSucceeded = true;
      if (entity?.id) {
        await this.fileRepository.softDelete(entity.id).catch((restoreError) => {
          recordRollbackSucceeded = false;
          this.logger?.error(
            `[FileUpload] Failed to roll back file record ${entity?.id}`,
            restoreError.stack,
          );
        });
      }

      if (stored?.path && recordRollbackSucceeded) {
        await storage.delete(stored.path).catch((deleteError) => {
          this.logger?.error(
            `[FileUpload] Failed to remove stored file after database error: ${stored?.path}`,
            deleteError.stack,
          );
        });
      }

      throw error;
    }

    return entity!;
  }

  getStorageOptions(): StorageOptionsResponse {
    const options = this.storageFactory.getAvailableStorageTypes().map((type) => ({
      value: type,
      label: STORAGE_OPTION_LABELS[type],
    }));

    return {
      defaultStorage: this.storageFactory.normalizeDefaultStorage(),
      options,
    };
  }

  async createDirectUpload(
    dto: CreateDirectUploadDto,
    uploaderId?: number,
    options?: FileValidationOptions,
  ): Promise<{
    method: 'PUT';
    uploadUrl: string;
    uploadToken: string;
    expiresAt: string;
    headers: Record<string, string>;
  }> {
    this.validateFileMetadata(dto.originalName, dto.mimeType, dto.size, options);

    const oss = this.storageFactory.getOssStrategy();
    const filename = FileUtil.generateUniqueFilename(dto.originalName);
    const relativePath = this.buildRelativePath(dto.module);
    const key = oss.buildObjectKey({ filename, relativePath, isPublic: dto.isPublic ?? false });
    const expiresAt = this.getExpiresAt(this.ossDirectUploadTtlSeconds);
    const contentType = this.getEffectiveMimeType(dto.originalName, dto.mimeType);
    const signedUpload = await oss.createSignedUploadUrl(key, this.ossDirectUploadTtlSeconds, {
      contentType,
      contentLength: dto.size,
    });
    const tokenPayload: DirectUploadTokenPayload = {
      type: 'oss-upload',
      key,
      originalName: dto.originalName,
      filename,
      size: dto.size,
      mimeType: contentType,
      category: FileUtil.getFileCategory(dto.originalName),
      module: dto.module,
      tags: dto.tags,
      isPublic: dto.isPublic ?? false,
      remark: dto.remark,
      uploaderId,
      exp: expiresAt.unix,
    };

    return {
      method: 'PUT',
      uploadUrl: signedUpload.url,
      uploadToken: this.signToken(tokenPayload),
      expiresAt: expiresAt.iso,
      headers: signedUpload.headers,
    };
  }

  async completeDirectUpload(dto: CompleteDirectUploadDto): Promise<FileEntity> {
    const payload = this.verifyToken<DirectUploadTokenPayload>(
      dto.uploadToken,
      '上传令牌无效或已过期',
    );
    if (payload.type !== 'oss-upload') {
      throw BusinessException.validationFailed('上传令牌无效或已过期');
    }

    const existing = await this.fileRepository.findOne({
      where: {
        path: payload.key,
        storage: FileStorageType.OSS,
      },
    });
    if (existing) {
      return existing;
    }

    const oss = this.storageFactory.getOssStrategy();
    const objectMeta = await oss.headObject(payload.key);
    if (objectMeta.contentLength !== payload.size) {
      await oss.delete(payload.key).catch((error) => {
        this.logger?.error(
          `[FileUpload] Failed to delete mismatched OSS object: ${payload.key}`,
          error.stack,
        );
      });
      throw BusinessException.validationFailed('OSS 文件大小与上传令牌不匹配');
    }

    try {
      const entity = await this.fileRepository.save(
        this.fileRepository.create({
          originalName: payload.originalName,
          filename: payload.filename,
          path: payload.key,
          url: undefined,
          mimeType: this.getEffectiveMimeType(
            payload.originalName,
            objectMeta.contentType || payload.mimeType,
          ),
          size: payload.size,
          category: payload.category,
          storage: FileStorageType.OSS,
          module: payload.module,
          tags: payload.tags,
          isPublic: payload.isPublic,
          remark: payload.remark,
          metadata: {
            directUpload: true,
            etag: objectMeta.etag,
          },
          uploaderId: payload.uploaderId,
        }),
      );
      return await this.ensurePublicDownloadUrl(entity);
    } catch (error) {
      await oss.delete(payload.key).catch((deleteError) => {
        this.logger?.error(
          `[FileUpload] Failed to remove OSS object after database error: ${payload.key}`,
          deleteError.stack,
        );
      });
      throw error;
    }
  }

  /**
   * 查询文件列表
   */
  async findFiles(query: QueryFileDto) {
    const filters: FileQueryOptions = {
      keyword: query.keyword,
      storage: query.storage,
      category: query.category,
      module: query.module,
      isPublic: query.isPublic,
    };

    const paginationOptions = {
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
    };

    return this.paginateFiles(paginationOptions, filters);
  }

  /**
   * 根据ID查询文件
   */
  async findById(id: number): Promise<FileEntity> {
    return this.normalizePublicAccessUrl(await this.findByIdOrFail(id));
  }

  /**
   * 检查文件下载权限
   * @param file 文件实体
   * @param user 当前用户
   * @throws ForbiddenException 无权限时抛出异常
   */
  checkDownloadPermission(file: FileEntity, user: UserWithRoles): void {
    // 如果文件是公开的，任何人都可以下载
    if (file.isPublic) {
      return;
    }

    // 检查是否是文件上传者
    const isOwner = file.uploaderId === user.id;
    if (isOwner) {
      return;
    }

    // 检查是否有管理员权限
    const hasAdminPermission = user.roles?.some((role) => {
      const code = typeof role === 'string' ? role : role.code;
      return code === 'admin' || code === 'super_admin';
    });

    if (!hasAdminPermission) {
      throw BusinessException.forbidden('无权下载此文件');
    }
  }

  /**
   * 删除文件（包含物理删除）
   */
  async remove(id: number): Promise<void> {
    const entity = await this.findById(id);
    const storage = this.getStorageStrategy(entity.storage);

    const deleteResult = await this.fileRepository.softDelete(id);
    if (!deleteResult.affected) {
      throw BusinessException.notFound('File', id);
    }

    try {
      if (entity.path) {
        await storage.delete(entity.path);
      }
    } catch (error) {
      await this.fileRepository.restore(id).catch((restoreError) => {
        this.logger?.error(
          `[FileDelete] Failed to restore file record ${id} after storage delete failure`,
          restoreError.stack,
        );
      });
      throw error;
    }
  }

  async getDownloadResult(
    id: number,
    disposition: FileAccessDisposition = 'attachment',
  ): Promise<FileDownloadResult> {
    const file = await this.findById(id);

    if (file.storage === FileStorageType.OSS) {
      const oss = this.storageFactory.getOssStrategy();
      return {
        file,
        disposition,
        redirectUrl: oss.createSignedDownloadUrl(file.path, this.signedOssDownloadTtlSeconds, {
          contentDisposition: this.buildContentDisposition(file, disposition),
        }),
      };
    }

    const storage = this.getStorageStrategy(file.storage);
    return {
      file,
      disposition,
      stream: await storage.getStream(file.path),
    };
  }

  async getPublicDownload(id: number): Promise<PublicDownloadResult> {
    const file = await this.findById(id);
    if (!file.isPublic) {
      throw BusinessException.notFound('File', id);
    }

    if (file.storage === FileStorageType.OSS) {
      const oss = this.storageFactory.getOssStrategy();
      const process = this.isImageFile(file) ? OSS_IMAGE_DEFAULT_INLINE_PROCESS : undefined;
      return {
        file,
        redirectUrl: oss.createSignedDownloadUrl(file.path, PUBLIC_OSS_CACHE_MAX_AGE_SECONDS, {
          contentDisposition: this.buildContentDisposition(file, 'inline'),
          ...(process ? { process } : {}),
          cacheControl: this.buildPublicCacheControl(PUBLIC_OSS_CACHE_MAX_AGE_SECONDS),
        }),
        cacheMaxAgeSeconds: PUBLIC_OSS_CACHE_MAX_AGE_SECONDS,
      };
    }

    const storage = this.getStorageStrategy(file.storage);
    return {
      file,
      stream: await storage.getStream(file.path),
    };
  }

  async normalizePublicAccessUrl(file: FileEntity): Promise<FileEntity> {
    return this.ensurePublicDownloadUrl(file);
  }

  async createAccessLink(
    id: number,
    user: UserWithRoles,
    dto: CreateFileAccessLinkDto,
  ): Promise<{
    url: string;
    token: string;
    expiresAt: string;
  }> {
    const file = await this.findById(id);
    this.checkDownloadPermission(file, user);

    return this.createTrustedAccessLink(id, { ...dto, file });
  }

  async createTrustedAccessLink(
    id: number,
    dto: CreateFileAccessLinkDto & TrustedAccessLinkOptions,
  ): Promise<{
    url: string;
    token: string;
    expiresAt: string;
    cacheMaxAgeSeconds?: number;
  }> {
    const file = dto.file ?? (await this.findById(id));
    const cacheMaxAgeSeconds = this.normalizeCacheMaxAgeSeconds(dto.cacheMaxAgeSeconds);
    const expiresAt = cacheMaxAgeSeconds
      ? this.getStableWindowExpiresAt(cacheMaxAgeSeconds)
      : this.getExpiresAt(this.privateLinkTtlSeconds);
    const disposition = dto.disposition ?? 'attachment';
    const process = this.getTrustedAccessProcess(file, dto.process, disposition);
    const tokenPayload: FileAccessTokenPayload = {
      type: 'file-access',
      fileId: id,
      disposition,
      process,
      cacheMaxAgeSeconds,
      exp: expiresAt.unix,
    };
    const token = this.signToken(tokenPayload);

    return {
      url: this.buildAccessUrl(id, token),
      token,
      expiresAt: expiresAt.iso,
      cacheMaxAgeSeconds,
    };
  }

  async resolveAccessLink(
    id: number,
    token: string,
  ): Promise<{
    file: FileEntity;
    disposition: FileAccessDisposition;
    stream?: NodeJS.ReadableStream;
    redirectUrl?: string;
    cacheMaxAgeSeconds?: number;
  }> {
    const payload = this.verifyToken<FileAccessTokenPayload>(token, '访问链接无效或已过期');
    if (payload.type !== 'file-access' || payload.fileId !== id) {
      throw BusinessException.forbidden('访问链接无效或已过期');
    }

    const file = await this.findById(id);
    const cacheMaxAgeSeconds = this.getAccessCacheMaxAgeSeconds(payload);
    if (file.storage === FileStorageType.OSS) {
      const oss = this.storageFactory.getOssStrategy();
      const cacheControl = this.buildPrivateCacheControl(cacheMaxAgeSeconds);
      return {
        file,
        disposition: payload.disposition,
        redirectUrl: oss.createSignedDownloadUrl(
          file.path,
          cacheMaxAgeSeconds ?? this.signedOssDownloadTtlSeconds,
          {
            contentDisposition: this.buildContentDisposition(file, payload.disposition),
            process: payload.process,
            cacheControl,
          },
        ),
        cacheMaxAgeSeconds,
      };
    }

    const storage = this.getStorageStrategy(file.storage);
    return {
      file,
      disposition: payload.disposition,
      stream: await storage.getStream(file.path),
      cacheMaxAgeSeconds,
    };
  }

  /**
   * 构建相对路径
   */
  private buildRelativePath(module?: string): string {
    const segments = [dayjs().format('YYYY/MM/DD')];
    const normalizedModule = module?.replace(/[^a-zA-Z0-9/_-]/g, '') || DEFAULT_FILE_MODULE;
    if (normalizedModule) {
      segments.unshift(normalizedModule);
    }
    return segments.join('/');
  }

  /**
   * 计算哈希
   */
  private computeHash(buffer: Buffer): string {
    return createHash('md5').update(buffer).digest('hex');
  }

  private buildPublicDownloadUrl(fileId: number): string {
    const base = this.getPublicFileBaseUrl();
    return `${base}/${fileId}/public`;
  }

  private async ensurePublicDownloadUrl(entity: FileEntity): Promise<FileEntity> {
    if (!entity.isPublic) {
      return entity;
    }

    const url = this.buildPublicDownloadUrl(entity.id);
    if (entity.url !== url) {
      entity.url = url;
      await this.fileRepository.update(entity.id, { url });
    }
    return entity;
  }

  private buildAccessUrl(fileId: number, token: string): string {
    const base = this.getPublicFileBaseUrl();
    return `${base}/${fileId}/access?token=${encodeURIComponent(token)}`;
  }

  private getPublicFileBaseUrl(): string {
    const base = this.publicFileBaseUrl.endsWith('/')
      ? this.publicFileBaseUrl.slice(0, -1)
      : this.publicFileBaseUrl;
    return base;
  }

  /**
   * 验证文件合法性
   */
  private validateFile(file: Express.Multer.File, options?: FileValidationOptions): void {
    this.validateFileMetadata(file.originalname, file.mimetype, file.size, options);
  }

  private validateFileMetadata(
    originalName: string,
    mimeType: string | undefined,
    size: number,
    options?: FileValidationOptions,
  ): void {
    const maxSize = options?.maxSize ?? this.maxFileSize;
    const allowedTypes = options?.allowedTypes ?? this.allowedTypes;

    // 1. 验证文件大小
    if (!FileUtil.validateFileSize(size, maxSize)) {
      throw BusinessException.validationFailed(
        `文件大小超出限制（最大 ${FileUtil.formatSize(maxSize)}）`,
      );
    }

    // 2. 验证文件扩展名
    if (!FileUtil.validateFileType(originalName, allowedTypes)) {
      throw BusinessException.validationFailed(
        `不支持的文件类型，仅允许：${allowedTypes.join(', ')}`,
      );
    }

    // 3. 验证MIME类型
    if (mimeType) {
      const effectiveMimeType = this.getEffectiveMimeType(originalName, mimeType);
      const allowedMimeTypes = this.getAllowedMimeTypes();
      if (!allowedMimeTypes.includes(effectiveMimeType)) {
        this.logger?.warn(
          `Rejected file with MIME type "${mimeType}" for "${originalName}" (effective: "${effectiveMimeType}")`,
        );
        throw BusinessException.validationFailed(`文件MIME类型不匹配: ${mimeType}`);
      }
    }

    // 4. 对于可执行文件和脚本文件，做额外检查
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.js', '.jar'];
    const ext = FileUtil.getExtension(originalName).toLowerCase();
    if (dangerousExtensions.includes(ext)) {
      throw BusinessException.validationFailed(`出于安全考虑，不允许上传 ${ext} 文件`);
    }
  }

  private getEffectiveMimeType(originalName: string, mimeType?: string): string {
    if (mimeType && mimeType !== 'application/octet-stream') {
      return mimeType;
    }

    const inferredMimeType = FileUtil.getMimeType(originalName);
    if (this.getAllowedMimeTypes().includes(inferredMimeType)) {
      return inferredMimeType;
    }

    return mimeType || inferredMimeType;
  }

  /**
   * 获取允许的MIME类型列表
   */
  private getAllowedMimeTypes(): string[] {
    return [
      // 图片
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      // 视频
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-matroska',
      'video/x-msvideo',
      'video/x-ms-wmv',
      // 文档
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // 文本
      'text/plain',
      // 压缩文件
      'application/zip',
      'application/x-zip-compressed',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      // 其他常见类型
      'application/octet-stream', // 通用二进制流（需要结合扩展名验证）
    ];
  }

  /**
   * 获取存储策略
   */
  private getStorageStrategy(storage?: FileStorageType): FileStorageStrategy {
    return this.storageFactory.getStrategy(storage || this.storageType);
  }

  /**
   * 解析允许的文件类型
   */
  private normalizeAllowedTypes(types: string | string[]): string[] {
    if (Array.isArray(types)) {
      return types.map((item) => item.trim()).filter(Boolean);
    }
    return types
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  /**
   * 从配置读取数值
   */
  private getNumber(path: string, defaultValue: number): number {
    const value = this.configService.get<string | number | undefined>(path);
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : defaultValue;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  private getExpiresAt(ttlSeconds: number): { unix: number; iso: string } {
    const unix = Math.floor(Date.now() / 1000) + ttlSeconds;
    return {
      unix,
      iso: new Date(unix * 1000).toISOString(),
    };
  }

  private getStableWindowExpiresAt(windowSeconds: number): { unix: number; iso: string } {
    const now = Math.floor(Date.now() / 1000);
    const unix = (Math.floor(now / windowSeconds) + 1) * windowSeconds;
    return {
      unix,
      iso: new Date(unix * 1000).toISOString(),
    };
  }

  private normalizeCacheMaxAgeSeconds(value?: number): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    const seconds = Math.floor(value);
    return seconds > 0 ? seconds : undefined;
  }

  private getAccessCacheMaxAgeSeconds(payload: FileAccessTokenPayload): number | undefined {
    const cacheMaxAgeSeconds = this.normalizeCacheMaxAgeSeconds(payload.cacheMaxAgeSeconds);
    if (!cacheMaxAgeSeconds) {
      return undefined;
    }

    const remainingSeconds = payload.exp - Math.floor(Date.now() / 1000);
    if (remainingSeconds <= 0) {
      return undefined;
    }

    return Math.min(cacheMaxAgeSeconds, remainingSeconds);
  }

  private buildPrivateCacheControl(maxAgeSeconds?: number): string | undefined {
    return maxAgeSeconds ? `private, max-age=${maxAgeSeconds}` : undefined;
  }

  private buildPublicCacheControl(maxAgeSeconds?: number): string | undefined {
    return maxAgeSeconds ? `public, max-age=${maxAgeSeconds}` : undefined;
  }

  private getTrustedAccessProcess(
    file: Pick<FileEntity, 'storage' | 'category' | 'mimeType' | 'originalName'>,
    requestedProcess: string | undefined,
    disposition: FileAccessDisposition,
  ): string | undefined {
    if (file.storage !== FileStorageType.OSS) {
      return undefined;
    }

    if (requestedProcess) {
      return requestedProcess;
    }

    if (disposition === 'inline' && this.isImageFile(file)) {
      return OSS_IMAGE_DEFAULT_INLINE_PROCESS;
    }

    return undefined;
  }

  private isImageFile(file: Pick<FileEntity, 'category' | 'mimeType' | 'originalName'>): boolean {
    if (file.category === 'image' || file.mimeType?.startsWith('image/')) {
      return true;
    }

    return FileUtil.isImage(file.originalName);
  }

  private signToken(payload: BaseTokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.getTokenSecret()).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private verifyToken<T extends BaseTokenPayload>(token: string, message: string): T {
    const [body, signature] = token.split('.');
    if (!body || !signature) {
      throw BusinessException.forbidden(message);
    }

    const expected = createHmac('sha256', this.getTokenSecret()).update(body).digest('base64url');
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw BusinessException.forbidden(message);
    }

    let payload: T;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    } catch {
      throw BusinessException.forbidden(message);
    }

    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw BusinessException.forbidden(message);
    }

    return payload;
  }

  private getTokenSecret(): string {
    return this.configService.get<string>('jwt.secret', 'dev-secret-key-change-this');
  }

  private buildContentDisposition(file: FileEntity, disposition: FileAccessDisposition): string {
    return `${disposition}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`;
  }

  private async findByIdOrFail(id: number): Promise<FileEntity> {
    const entity = await this.fileRepository.findOne({ where: { id } });
    if (!entity) {
      throw BusinessException.notFound('File', id);
    }
    return entity;
  }

  private async paginateFiles(
    pagination: PaginationOptions,
    query: FileQueryOptions,
  ): Promise<PaginationResult<FileEntity>> {
    const qb = this.fileRepository.createQueryBuilder('file');
    qb.leftJoinAndSelect('file.uploader', 'uploader');

    if (query.keyword) {
      qb.andWhere('(file.originalName LIKE :keyword OR file.filename LIKE :keyword)', {
        keyword: `%${query.keyword}%`,
      });
    }

    if (query.storage) {
      qb.andWhere('file.storage = :storage', { storage: query.storage });
    }

    if (query.category) {
      qb.andWhere('file.category = :category', { category: query.category });
    }

    if (query.module) {
      qb.andWhere('file.module = :module', { module: query.module });
    }

    if (query.isPublic !== undefined) {
      qb.andWhere('file.isPublic = :isPublic', { isPublic: query.isPublic });
    }

    qb.orderBy(
      pagination.sort && FILE_SORT_FIELDS.has(pagination.sort)
        ? `file.${pagination.sort}`
        : 'file.createdAt',
      pagination.order || 'DESC',
    );

    const page = Math.max(1, pagination.page || 1);
    const limit = Math.min(100, Math.max(1, pagination.limit || 10));
    const skip = (page - 1) * limit;

    const [items, totalItems] = await qb.skip(skip).take(limit).getManyAndCount();
    const normalizedItems = await Promise.all(
      items.map((item) => this.normalizePublicAccessUrl(item)),
    );

    return {
      items: normalizedItems,
      meta: {
        totalItems,
        itemCount: normalizedItems.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
      },
    };
  }
}
