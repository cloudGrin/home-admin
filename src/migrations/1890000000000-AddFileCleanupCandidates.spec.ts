import { readFileSync } from 'fs';
import { join } from 'path';

describe('AddFileCleanupCandidates migration', () => {
  const source = readFileSync(join(__dirname, '1890000000000-AddFileCleanupCandidates.ts'), 'utf8');

  it('creates the file cleanup candidates table with a stable identity', () => {
    expect(source).toContain('CREATE TABLE file_cleanup_candidates');
    expect(source).toContain('identity varchar(600) NOT NULL');
    expect(source).toContain('UNIQUE KEY UQ_file_cleanup_candidates_identity (identity)');
  });

  it('tracks review status and action metadata for manual confirmation', () => {
    expect(source).toContain("enum('pending', 'stale', 'ignored', 'deleted', 'failed')");
    expect(source).toContain('acted_by_user_id int NULL');
    expect(source).toContain('error_message varchar(1000) NULL');
  });
});
