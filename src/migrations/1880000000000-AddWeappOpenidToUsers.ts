import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeappOpenidToUsers1880000000000 implements MigrationInterface {
  name = 'AddWeappOpenidToUsers1880000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN weapp_openid varchar(64) NULL COMMENT '微信小程序 openid',
      ADD COLUMN weapp_bound_at timestamp NULL COMMENT '微信小程序绑定时间',
      ADD UNIQUE KEY UQ_users_weapp_openid (weapp_openid)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE users DROP INDEX UQ_users_weapp_openid');
    await queryRunner.query('ALTER TABLE users DROP COLUMN weapp_bound_at');
    await queryRunner.query('ALTER TABLE users DROP COLUMN weapp_openid');
  }
}
