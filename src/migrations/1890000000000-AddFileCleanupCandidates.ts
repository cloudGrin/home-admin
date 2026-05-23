import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFileCleanupCandidates1890000000000 implements MigrationInterface {
  name = 'AddFileCleanupCandidates1890000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE file_cleanup_candidates (
        id int NOT NULL AUTO_INCREMENT,
        createdAt timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
        updatedAt timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
        identity varchar(600) NOT NULL COMMENT '稳定唯一标识，例如 db:123 或 oss:family-chat/2026/05/21/a.jpg',
        source enum('db_orphan', 'oss_untracked') NOT NULL COMMENT '候选来源',
        status enum('pending', 'stale', 'ignored', 'deleted', 'failed') NOT NULL DEFAULT 'pending' COMMENT '处理状态',
        storage enum('local', 'oss') NOT NULL COMMENT '存储类型',
        module varchar(100) NULL COMMENT '业务模块标识',
        file_id int NULL COMMENT 'DB orphan 对应 files.id，OSS 未登记对象为空',
        object_key varchar(500) NOT NULL COMMENT '本地 path 或 OSS object key',
        original_name varchar(255) NULL COMMENT '原始文件名',
        mime_type varchar(100) NULL COMMENT 'MIME 类型',
        category varchar(50) NULL COMMENT '文件类别',
        size bigint NULL COMMENT '文件大小',
        file_created_at timestamp NULL COMMENT '文件记录创建时间',
        object_last_modified timestamp NULL COMMENT 'OSS 对象最后修改时间',
        reason varchar(100) NOT NULL COMMENT '候选原因',
        last_scan_token varchar(64) NULL COMMENT '最近扫描批次',
        last_seen_at timestamp NULL COMMENT '最近扫描发现时间',
        checked_at timestamp NULL COMMENT '最近安全检查时间',
        acted_at timestamp NULL COMMENT '人工操作时间',
        acted_by_user_id int NULL COMMENT '操作人ID',
        action_message varchar(500) NULL COMMENT '操作备注',
        error_message varchar(1000) NULL COMMENT '错误信息',
        PRIMARY KEY (id),
        UNIQUE KEY UQ_file_cleanup_candidates_identity (identity),
        KEY IDX_file_cleanup_candidates_status_updatedAt (status, updatedAt),
        KEY IDX_file_cleanup_candidates_source_status (source, status),
        KEY IDX_file_cleanup_candidates_file_id (file_id),
        KEY IDX_file_cleanup_candidates_object_key (object_key),
        CONSTRAINT FK_file_cleanup_candidates_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS file_cleanup_candidates');
  }
}
