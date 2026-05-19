import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPersistentTokenRevocationAndMenuPathUnique1770000000000 implements MigrationInterface {
  name = 'AddPersistentTokenRevocationAndMenuPathUnique1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN tokenVersion int NOT NULL DEFAULT 0 COMMENT '访问Token版本'
    `);
    await queryRunner.query(`
      ALTER TABLE menus
      ADD COLUMN active_path varchar(200)
      GENERATED ALWAYS AS (
        CASE WHEN deletedAt IS NULL THEN path ELSE NULL END
      ) STORED
    `);
    await queryRunner.query(`
      ALTER TABLE menus
      ADD UNIQUE KEY UQ_menus_active_path (active_path)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE menus DROP INDEX UQ_menus_active_path');
    await queryRunner.query('ALTER TABLE menus DROP COLUMN active_path');
    await queryRunner.query('ALTER TABLE users DROP COLUMN tokenVersion');
  }
}
