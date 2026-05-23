import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '~/common/dto/pagination.dto';
import { FileStorageType } from '../entities/file.entity';
import {
  FileCleanupCandidateSource,
  FileCleanupCandidateStatus,
} from '../entities/file-cleanup-candidate.entity';

export class QueryFileCleanupCandidatesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: FileCleanupCandidateStatus, description: '候选状态' })
  @IsOptional()
  @IsEnum(FileCleanupCandidateStatus)
  status?: FileCleanupCandidateStatus;

  @ApiPropertyOptional({ enum: FileCleanupCandidateSource, description: '候选来源' })
  @IsOptional()
  @IsEnum(FileCleanupCandidateSource)
  source?: FileCleanupCandidateSource;

  @ApiPropertyOptional({ enum: FileStorageType, description: '存储类型' })
  @IsOptional()
  @IsEnum(FileStorageType)
  storage?: FileStorageType;

  @ApiPropertyOptional({ description: '业务模块' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  module?: string;

  @ApiPropertyOptional({ description: '对象 key 或文件名关键字' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
}

export class ScanFileCleanupCandidatesDto {
  @ApiPropertyOptional({ description: 'DB 文件记录保留小时数', default: 168, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fileOlderThanHours?: number;

  @ApiPropertyOptional({ description: 'OSS 未登记对象保留小时数', default: 24, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ossObjectOlderThanHours?: number;

  @ApiPropertyOptional({
    description: '单次扫描候选数量上限',
    default: 100,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class DeleteFileCleanupCandidatesDto {
  @ApiProperty({ description: '候选ID列表', type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  ids: number[];
}

export class IgnoreFileCleanupCandidatesDto extends DeleteFileCleanupCandidatesDto {
  @ApiPropertyOptional({ description: '忽略备注', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
