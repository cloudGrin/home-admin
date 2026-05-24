import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { posix } from 'path';
import { DataSource, In, Repository } from 'typeorm';
import { BusinessException } from '~/common/exceptions/business.exception';
import { PaginationResult } from '~/common/types/pagination.types';
import { LoggerService } from '~/shared/logger/logger.service';
import { FileEntity, FileStorageType } from '../entities/file.entity';
import {
  FileCleanupCandidateEntity,
  FileCleanupCandidateSource,
  FileCleanupCandidateStatus,
} from '../entities/file-cleanup-candidate.entity';
import { QueryFileCleanupCandidatesDto } from '../dto/file-cleanup.dto';
import { FileStorageFactory } from '../storage/storage.factory';
import { FileService } from './file.service';

const DB_CLEANUP_MODULES = [
  'task-attachment',
  'insurance-policy',
  'baby-avatar',
  'baby-birthday',
  'family-circle',
  'family-chat',
] as const;
const OSS_CLEANUP_PREFIXES = [
  'files',
  ...DB_CLEANUP_MODULES,
  'user-avatar',
  'document',
  'image',
  'video',
  'audio',
  'other',
  'avatar',
] as const;

const DEFAULT_FILE_OLDER_THAN_HOURS = 168;
const DEFAULT_OSS_OBJECT_OLDER_THAN_HOURS = 24;
const DEFAULT_SCAN_LIMIT = 100;
const MAX_SCAN_LIMIT = 500;
const OSS_LIST_PAGE_SIZE = 1000;
const PREVIEW_LINK_TTL_SECONDS = 300;
const CANDIDATE_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'lastSeenAt',
  'checkedAt',
  'actedAt',
  'size',
]);
const DELETABLE_STATUSES = new Set<FileCleanupCandidateStatus>([
  FileCleanupCandidateStatus.PENDING,
  FileCleanupCandidateStatus.FAILED,
]);
const TERMINAL_STATUSES = new Set<FileCleanupCandidateStatus>([
  FileCleanupCandidateStatus.IGNORED,
  FileCleanupCandidateStatus.DELETED,
]);

export interface FileCleanupScanOptions {
  fileOlderThanHours?: number;
  ossObjectOlderThanHours?: number;
  limit?: number;
  now?: Date;
}

export interface FileCleanupScanResult {
  scanned: number;
  created: number;
  refreshed: number;
  stale: number;
}

export interface FileCleanupDeleteResult {
  requested: number;
  deleted: number;
  stale: number;
  failed: number;
}

export interface FileCleanupAccessLinkResult {
  url: string;
  token?: string;
  expiresAt: string;
  cacheMaxAgeSeconds?: number;
}

interface FileCleanupAccessUser {
  id: number;
  roles?: Array<{ code: string } | string>;
}

interface NormalizedScanOptions {
  fileOlderThanHours: number;
  ossObjectOlderThanHours: number;
  limit: number;
  now: Date;
}

interface CandidateInput {
  identity: string;
  source: FileCleanupCandidateSource;
  storage: FileStorageType;
  module?: string | null;
  fileId?: number | null;
  objectKey: string;
  originalName?: string | null;
  mimeType?: string | null;
  category?: string | null;
  size?: number | string | null;
  fileCreatedAt?: Date | null;
  objectLastModified?: Date | null;
  reason: string;
}

interface OssCandidateScan {
  candidates: CandidateInput[];
  complete: boolean;
}

@Injectable()
export class FileCleanupService {
  constructor(
    @InjectRepository(FileCleanupCandidateEntity)
    private readonly candidateRepository: Repository<FileCleanupCandidateEntity>,
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    private readonly dataSource: DataSource,
    private readonly fileService: FileService,
    private readonly storageFactory: FileStorageFactory,
    private readonly logger: LoggerService,
  ) {}

  async scanCandidates(options: FileCleanupScanOptions = {}): Promise<FileCleanupScanResult> {
    const normalized = this.normalizeScanOptions(options);
    const scanToken = this.createScanToken(normalized.now);
    const result: FileCleanupScanResult = {
      scanned: 0,
      created: 0,
      refreshed: 0,
      stale: 0,
    };

    const seenIdentities = new Set<string>();
    const staleEligibleSources: FileCleanupCandidateSource[] = [];
    const dbScanComplete = await this.scanDbOrphanFiles(
      normalized,
      scanToken,
      seenIdentities,
      result,
    );
    if (dbScanComplete) {
      staleEligibleSources.push(FileCleanupCandidateSource.DB_ORPHAN);
    }

    if (seenIdentities.size < normalized.limit && this.isOssStorageAvailable()) {
      const ossScan = await this.findUntrackedOssObjects(
        normalized,
        normalized.limit - seenIdentities.size,
      );
      for (const candidate of ossScan.candidates) {
        if (seenIdentities.size >= normalized.limit) break;
        if (seenIdentities.has(candidate.identity)) continue;

        seenIdentities.add(candidate.identity);
        result.scanned += 1;
        const action = await this.upsertCandidate(candidate, scanToken, normalized.now);
        result[action] += 1;
      }

      if (ossScan.complete) {
        staleEligibleSources.push(FileCleanupCandidateSource.OSS_UNTRACKED);
      }
    }

    result.stale = await this.markMissingOpenCandidatesStale(
      scanToken,
      normalized.now,
      staleEligibleSources,
    );
    return result;
  }

  async findCandidates(
    query: QueryFileCleanupCandidatesDto,
  ): Promise<PaginationResult<FileCleanupCandidateEntity>> {
    const qb = this.candidateRepository.createQueryBuilder('candidate');

    if (query.status) {
      qb.andWhere('candidate.status = :status', { status: query.status });
    }
    if (query.source) {
      qb.andWhere('candidate.source = :source', { source: query.source });
    }
    if (query.storage) {
      qb.andWhere('candidate.storage = :storage', { storage: query.storage });
    }
    if (query.module) {
      qb.andWhere('candidate.module = :module', { module: query.module });
    }
    if (query.keyword) {
      qb.andWhere(
        '(candidate.objectKey LIKE :keyword OR candidate.originalName LIKE :keyword OR candidate.errorMessage LIKE :keyword)',
        { keyword: `%${query.keyword}%` },
      );
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const sort =
      query.sort && CANDIDATE_SORT_FIELDS.has(query.sort)
        ? `candidate.${query.sort}`
        : 'candidate.updatedAt';
    qb.orderBy(sort, query.order ?? 'DESC');

    const [items, totalItems] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      meta: {
        totalItems,
        itemCount: items.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
      },
    };
  }

  async deleteCandidates(ids: number[], userId: number): Promise<FileCleanupDeleteResult> {
    const result: FileCleanupDeleteResult = {
      requested: ids.length,
      deleted: 0,
      stale: 0,
      failed: 0,
    };
    const candidates = await this.candidateRepository.find({ where: { id: In(ids) } });

    for (const candidate of candidates) {
      if (!DELETABLE_STATUSES.has(candidate.status)) {
        continue;
      }

      candidate.checkedAt = new Date();
      try {
        const safe = await this.isCandidateStillSafe(candidate);
        if (!safe) {
          this.markStale(candidate);
          result.stale += 1;
          await this.candidateRepository.save(candidate);
          continue;
        }

        if (candidate.source === FileCleanupCandidateSource.DB_ORPHAN) {
          await this.fileService.remove(candidate.fileId!);
        } else {
          await this.storageFactory.getOssStrategy().delete(candidate.objectKey);
        }

        candidate.status = FileCleanupCandidateStatus.DELETED;
        candidate.actedAt = new Date();
        candidate.actedByUserId = userId;
        candidate.actionMessage = '确认删除';
        candidate.errorMessage = null;
        result.deleted += 1;
      } catch (error) {
        candidate.status = FileCleanupCandidateStatus.FAILED;
        candidate.errorMessage = this.errorMessage(error);
        result.failed += 1;
        this.logger.error(
          `[FileCleanup] Failed to delete candidate ${candidate.id}: ${candidate.errorMessage}`,
        );
      }

      await this.candidateRepository.save(candidate);
    }

    return result;
  }

  async createAccessLink(
    id: number,
    user: FileCleanupAccessUser,
  ): Promise<FileCleanupAccessLinkResult> {
    const candidate = await this.candidateRepository.findOne({ where: { id } });
    if (!candidate) {
      throw BusinessException.notFound('File cleanup candidate', id);
    }

    if (!DELETABLE_STATUSES.has(candidate.status)) {
      throw BusinessException.validationFailed('该候选当前状态不可预览');
    }

    const safe = await this.isCandidateStillSafe(candidate);
    if (!safe) {
      throw BusinessException.validationFailed('该候选已不可安全预览');
    }

    if (candidate.source === FileCleanupCandidateSource.DB_ORPHAN) {
      if (!candidate.fileId) {
        throw BusinessException.validationFailed('该候选已不可安全预览');
      }

      const file = await this.fileRepository.findOne({ where: { id: candidate.fileId } });
      if (!file) {
        throw BusinessException.validationFailed('该候选已不可安全预览');
      }

      this.fileService.checkDownloadPermission(file, user);

      return this.fileService.createTrustedAccessLink(file.id, {
        disposition: 'inline',
        cacheMaxAgeSeconds: PREVIEW_LINK_TTL_SECONDS,
        file,
      });
    }

    const expiresAt = new Date(Date.now() + PREVIEW_LINK_TTL_SECONDS * 1000).toISOString();
    const url = this.storageFactory
      .getOssStrategy()
      .createSignedDownloadUrl(candidate.objectKey, PREVIEW_LINK_TTL_SECONDS, {
        contentDisposition: this.buildInlineContentDisposition(candidate),
      });

    return {
      url,
      expiresAt,
      cacheMaxAgeSeconds: PREVIEW_LINK_TTL_SECONDS,
    };
  }

  async ignoreCandidates(
    ids: number[],
    userId: number,
    message?: string,
  ): Promise<{ updated: number }> {
    const candidates = await this.candidateRepository.find({ where: { id: In(ids) } });
    let updated = 0;

    for (const candidate of candidates) {
      if (candidate.status === FileCleanupCandidateStatus.DELETED) {
        continue;
      }

      candidate.status = FileCleanupCandidateStatus.IGNORED;
      candidate.actedAt = new Date();
      candidate.actedByUserId = userId;
      candidate.actionMessage = message?.trim() || '确认忽略';
      candidate.errorMessage = null;
      await this.candidateRepository.save(candidate);
      updated += 1;
    }

    return { updated };
  }

  private async scanDbOrphanFiles(
    options: NormalizedScanOptions,
    scanToken: string,
    seenIdentities: Set<string>,
    result: FileCleanupScanResult,
  ): Promise<boolean> {
    const pageSize = options.limit;
    let offset = 0;

    while (seenIdentities.size < options.limit) {
      const files = await this.findDbOrphanFiles(options, offset, pageSize);
      offset += files.length;

      for (const file of files) {
        if (seenIdentities.size >= options.limit) break;
        const identity = `db:${file.id}`;
        if (await this.isTerminalCandidate(identity)) continue;
        if (await this.hasBusinessReference(file.id)) continue;

        seenIdentities.add(identity);
        result.scanned += 1;
        const action = await this.upsertCandidate(
          this.toDbCandidateInput(file),
          scanToken,
          options.now,
        );
        result[action] += 1;
      }

      if (files.length < pageSize) {
        return true;
      }
    }

    return false;
  }

  private async findDbOrphanFiles(
    options: NormalizedScanOptions,
    offset: number,
    limit: number,
  ): Promise<FileEntity[]> {
    const cutoff = this.subtractHours(options.now, options.fileOlderThanHours);
    return this.fileRepository
      .createQueryBuilder('file')
      .where('file.isPublic = :isPublic', { isPublic: false })
      .andWhere('file.module IN (:...modules)', { modules: DB_CLEANUP_MODULES })
      .andWhere('file.deletedAt IS NULL')
      .andWhere('file.createdAt < :cutoff', { cutoff })
      .orderBy('file.createdAt', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();
  }

  private async findUntrackedOssObjects(
    options: NormalizedScanOptions,
    limit: number,
  ): Promise<OssCandidateScan> {
    const candidates: CandidateInput[] = [];
    const cutoff = this.subtractHours(options.now, options.ossObjectOlderThanHours);
    const oss = this.storageFactory.getOssStrategy();
    let complete = true;

    for (const module of OSS_CLEANUP_PREFIXES) {
      let continuationToken: string | undefined;
      do {
        const result = await oss.listObjects(`${module}/`, {
          continuationToken,
          maxKeys: OSS_LIST_PAGE_SIZE,
        });

        for (const object of result.objects) {
          if (candidates.length >= limit) break;
          if (!object.lastModified || object.lastModified >= cutoff) continue;

          const activeFile = await this.fileRepository.findOne({
            where: {
              storage: FileStorageType.OSS,
              path: object.key,
            },
          });
          if (activeFile) continue;

          const identity = `oss:${object.key}`;
          if (await this.isTerminalCandidate(identity)) continue;

          candidates.push({
            identity,
            source: FileCleanupCandidateSource.OSS_UNTRACKED,
            storage: FileStorageType.OSS,
            module,
            fileId: null,
            objectKey: object.key,
            size: object.size ?? null,
            objectLastModified: object.lastModified,
            reason: 'oss_no_active_file_record',
          });
        }

        continuationToken = result.nextContinuationToken ?? undefined;
      } while (continuationToken && candidates.length < limit);

      if (candidates.length >= limit) {
        complete = false;
        break;
      }
    }

    return { candidates, complete };
  }

  private toDbCandidateInput(file: FileEntity): CandidateInput {
    return {
      identity: `db:${file.id}`,
      source: FileCleanupCandidateSource.DB_ORPHAN,
      storage: file.storage,
      module: file.module ?? null,
      fileId: file.id,
      objectKey: file.path,
      originalName: file.originalName,
      mimeType: file.mimeType,
      category: file.category,
      size: file.size,
      fileCreatedAt: file.createdAt,
      reason: 'no_business_reference',
    };
  }

  private async upsertCandidate(
    input: CandidateInput,
    scanToken: string,
    now: Date,
  ): Promise<'created' | 'refreshed'> {
    const existing = await this.candidateRepository.findOne({
      where: { identity: input.identity },
    });

    if (existing) {
      Object.assign(existing, input, {
        status: TERMINAL_STATUSES.has(existing.status)
          ? existing.status
          : FileCleanupCandidateStatus.PENDING,
        lastScanToken: scanToken,
        lastSeenAt: now,
        checkedAt: now,
        errorMessage: TERMINAL_STATUSES.has(existing.status) ? existing.errorMessage : null,
      });
      await this.candidateRepository.save(existing);
      return 'refreshed';
    }

    await this.candidateRepository.save(
      this.candidateRepository.create({
        ...input,
        status: FileCleanupCandidateStatus.PENDING,
        lastScanToken: scanToken,
        lastSeenAt: now,
        checkedAt: now,
      }),
    );
    return 'created';
  }

  private async markMissingOpenCandidatesStale(
    scanToken: string,
    now: Date,
    sources: FileCleanupCandidateSource[],
  ): Promise<number> {
    if (sources.length === 0) {
      return 0;
    }

    const candidates = await this.candidateRepository.find({
      where: [
        { status: FileCleanupCandidateStatus.PENDING, source: In(sources) },
        { status: FileCleanupCandidateStatus.FAILED, source: In(sources) },
      ],
    });
    let stale = 0;

    for (const candidate of candidates) {
      if (candidate.lastScanToken === scanToken) continue;
      this.markStale(candidate, now);
      await this.candidateRepository.save(candidate);
      stale += 1;
    }

    return stale;
  }

  private markStale(candidate: FileCleanupCandidateEntity, now = new Date()): void {
    candidate.status = FileCleanupCandidateStatus.STALE;
    candidate.checkedAt = now;
    candidate.errorMessage = null;
  }

  private async isCandidateStillSafe(candidate: FileCleanupCandidateEntity): Promise<boolean> {
    if (candidate.source === FileCleanupCandidateSource.DB_ORPHAN) {
      if (!candidate.fileId) return false;
      const file = await this.fileRepository.findOne({ where: { id: candidate.fileId } });
      if (!file) return false;
      return !(await this.hasBusinessReference(file.id));
    }

    const activeFile = await this.fileRepository.findOne({
      where: { storage: FileStorageType.OSS, path: candidate.objectKey },
    });
    if (activeFile) {
      return false;
    }

    return this.isOssObjectStillPresent(candidate);
  }

  private async isOssObjectStillPresent(candidate: FileCleanupCandidateEntity): Promise<boolean> {
    const module = candidate.module || this.getModuleFromObjectKey(candidate.objectKey);
    if (
      !module ||
      !OSS_CLEANUP_PREFIXES.includes(module as (typeof OSS_CLEANUP_PREFIXES)[number])
    ) {
      return false;
    }

    let continuationToken: string | undefined;
    do {
      const result = await this.storageFactory.getOssStrategy().listObjects(`${module}/`, {
        continuationToken,
        maxKeys: 1000,
      });
      if (result.objects.some((object) => object.key === candidate.objectKey)) {
        return true;
      }
      continuationToken = result.nextContinuationToken ?? undefined;
    } while (continuationToken);

    return false;
  }

  private async isTerminalCandidate(identity: string): Promise<boolean> {
    const existing = await this.candidateRepository.findOne({ where: { identity } });
    return !!existing && TERMINAL_STATUSES.has(existing.status);
  }

  private async hasBusinessReference(fileId: number): Promise<boolean> {
    const rows = await this.dataSource.query(
      `
      SELECT 1 AS found
      WHERE EXISTS (SELECT 1 FROM task_attachments WHERE file_id = ?)
         OR EXISTS (SELECT 1 FROM insurance_policy_attachments WHERE file_id = ?)
         OR EXISTS (SELECT 1 FROM baby_profiles WHERE avatar_file_id = ?)
         OR EXISTS (SELECT 1 FROM baby_birthdays WHERE cover_file_id = ?)
         OR EXISTS (SELECT 1 FROM baby_birthday_media WHERE file_id = ?)
         OR EXISTS (SELECT 1 FROM family_post_media WHERE file_id = ?)
         OR EXISTS (SELECT 1 FROM family_chat_message_media WHERE file_id = ?)
      LIMIT 1
      `,
      [fileId, fileId, fileId, fileId, fileId, fileId, fileId],
    );

    return Array.isArray(rows) && rows.length > 0;
  }

  private normalizeScanOptions(options: FileCleanupScanOptions): NormalizedScanOptions {
    return {
      fileOlderThanHours: this.positiveInt(
        options.fileOlderThanHours,
        DEFAULT_FILE_OLDER_THAN_HOURS,
      ),
      ossObjectOlderThanHours: this.positiveInt(
        options.ossObjectOlderThanHours,
        DEFAULT_OSS_OBJECT_OLDER_THAN_HOURS,
      ),
      limit: Math.min(MAX_SCAN_LIMIT, this.positiveInt(options.limit, DEFAULT_SCAN_LIMIT)),
      now: options.now ?? new Date(),
    };
  }

  private positiveInt(value: unknown, fallback: number): number {
    const numberValue = Number(value);
    return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : fallback;
  }

  private subtractHours(value: Date, hours: number): Date {
    return new Date(value.getTime() - hours * 60 * 60 * 1000);
  }

  private createScanToken(now: Date): string {
    return `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private getModuleFromObjectKey(objectKey: string): string | undefined {
    return objectKey.split('/')[0] || undefined;
  }

  private buildInlineContentDisposition(candidate: FileCleanupCandidateEntity): string {
    const filename = candidate.originalName?.trim() || posix.basename(candidate.objectKey);
    return `inline; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }

  private isOssStorageAvailable(): boolean {
    return this.storageFactory.getAvailableStorageTypes().includes(FileStorageType.OSS);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
