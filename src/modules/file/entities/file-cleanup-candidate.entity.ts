import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '~/core/base/base.entity';
import { UserEntity } from '~/modules/user/entities/user.entity';
import { FileEntity, FileStorageType } from './file.entity';

export enum FileCleanupCandidateSource {
  DB_ORPHAN = 'db_orphan',
  OSS_UNTRACKED = 'oss_untracked',
}

export enum FileCleanupCandidateStatus {
  PENDING = 'pending',
  STALE = 'stale',
  IGNORED = 'ignored',
  DELETED = 'deleted',
  FAILED = 'failed',
}

@Entity('file_cleanup_candidates')
@Index(['identity'], { unique: true })
@Index(['status', 'updatedAt'])
@Index(['source', 'status'])
@Index(['fileId'])
@Index(['objectKey'])
export class FileCleanupCandidateEntity extends BaseEntity {
  @Column({
    type: 'varchar',
    length: 600,
    comment: '稳定唯一标识，例如 db:123 或 oss:family-chat/2026/05/21/a.jpg',
  })
  identity: string;

  @Column({
    type: 'enum',
    enum: FileCleanupCandidateSource,
    comment: '候选来源',
  })
  source: FileCleanupCandidateSource;

  @Column({
    type: 'enum',
    enum: FileCleanupCandidateStatus,
    default: FileCleanupCandidateStatus.PENDING,
    comment: '处理状态',
  })
  status: FileCleanupCandidateStatus;

  @Column({
    type: 'enum',
    enum: FileStorageType,
    comment: '存储类型',
  })
  storage: FileStorageType;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '业务模块标识',
  })
  module?: string | null;

  @Column({
    name: 'file_id',
    type: 'int',
    nullable: true,
    comment: 'DB orphan 对应 files.id，OSS 未登记对象为空',
  })
  fileId?: number | null;

  @ManyToOne(() => FileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'file_id' })
  file?: FileEntity | null;

  @Column({
    name: 'object_key',
    type: 'varchar',
    length: 500,
    comment: '本地 path 或 OSS object key',
  })
  objectKey: string;

  @Column({
    name: 'original_name',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '原始文件名',
  })
  originalName?: string | null;

  @Column({
    name: 'mime_type',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'MIME 类型',
  })
  mimeType?: string | null;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: '文件类别',
  })
  category?: string | null;

  @Column({
    type: 'bigint',
    nullable: true,
    comment: '文件大小',
  })
  size?: number | string | null;

  @Column({
    name: 'file_created_at',
    type: 'timestamp',
    nullable: true,
    comment: '文件记录创建时间',
  })
  fileCreatedAt?: Date | null;

  @Column({
    name: 'object_last_modified',
    type: 'timestamp',
    nullable: true,
    comment: 'OSS 对象最后修改时间',
  })
  objectLastModified?: Date | null;

  @Column({
    type: 'varchar',
    length: 100,
    comment: '候选原因',
  })
  reason: string;

  @Column({
    name: 'last_scan_token',
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: '最近扫描批次',
  })
  lastScanToken?: string | null;

  @Column({
    name: 'last_seen_at',
    type: 'timestamp',
    nullable: true,
    comment: '最近扫描发现时间',
  })
  lastSeenAt?: Date | null;

  @Column({
    name: 'checked_at',
    type: 'timestamp',
    nullable: true,
    comment: '最近安全检查时间',
  })
  checkedAt?: Date | null;

  @Column({
    name: 'acted_at',
    type: 'timestamp',
    nullable: true,
    comment: '人工操作时间',
  })
  actedAt?: Date | null;

  @Column({
    name: 'acted_by_user_id',
    type: 'int',
    nullable: true,
    comment: '操作人ID',
  })
  actedByUserId?: number | null;

  @ManyToOne(() => UserEntity, { nullable: true, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'acted_by_user_id' })
  actedByUser?: UserEntity | null;

  @Column({
    name: 'action_message',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: '操作备注',
  })
  actionMessage?: string | null;

  @Column({
    name: 'error_message',
    type: 'varchar',
    length: 1000,
    nullable: true,
    comment: '错误信息',
  })
  errorMessage?: string | null;
}
