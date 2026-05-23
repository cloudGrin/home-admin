import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule, MulterModuleOptions } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { memoryStorage } from 'multer';
import { DEFAULT_FILE_MAX_SIZE } from '~/config/constants';
import { FileEntity } from './entities/file.entity';
import { FileCleanupCandidateEntity } from './entities/file-cleanup-candidate.entity';
import { FileService } from './services/file.service';
import { FileController } from './controllers/file.controller';
import { FileCleanupController } from './controllers/file-cleanup.controller';
import { FileCleanupService } from './services/file-cleanup.service';
import { LocalStorageStrategy } from './storage/local-storage.strategy';
import { OssStorageStrategy } from './storage/oss-storage.strategy';
import { FileStorageFactory } from './storage/storage.factory';

export function buildFileUploadMulterOptions(configService: ConfigService): MulterModuleOptions {
  const configuredSize = configService.get<number>('file.maxSize', DEFAULT_FILE_MAX_SIZE);
  const fileSize =
    typeof configuredSize === 'number' && Number.isFinite(configuredSize) && configuredSize > 0
      ? configuredSize
      : DEFAULT_FILE_MAX_SIZE;

  return {
    storage: memoryStorage(),
    limits: { fileSize },
  };
}

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity, FileCleanupCandidateEntity]),
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: buildFileUploadMulterOptions,
    }),
  ],
  controllers: [FileController, FileCleanupController],
  providers: [
    FileService,
    FileCleanupService,
    LocalStorageStrategy,
    OssStorageStrategy,
    FileStorageFactory,
  ],
  exports: [FileService, FileCleanupService],
})
export class FileModule {}
