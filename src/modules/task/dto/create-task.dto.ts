import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TaskRecurrenceType, TaskType } from '../entities/task.entity';
import { TaskCheckItemInputDto } from './task-check-item.dto';

export class CreateTaskDto {
  @ApiProperty({
    description: '任务标题',
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: '任务标题不能为空' })
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({
    description: '任务描述',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: '所属清单ID',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  listId: number;

  @ApiPropertyOptional({
    description: '负责人用户ID',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assigneeId?: number;

  @ApiPropertyOptional({
    description: '任务类型',
    enum: TaskType,
    default: TaskType.TASK,
  })
  @IsOptional()
  @IsEnum(TaskType)
  taskType?: TaskType;

  @ApiProperty({
    description: '到期时间',
  })
  @IsDateString()
  dueAt: string;

  @ApiPropertyOptional({
    description: '提醒时间',
  })
  @IsOptional()
  @IsDateString()
  remindAt?: string;

  @ApiPropertyOptional({
    description: '是否重要',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  important?: boolean;

  @ApiPropertyOptional({
    description: '是否紧急',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  urgent?: boolean;

  @ApiPropertyOptional({
    description: '标签',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: '附件文件ID列表',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  attachmentFileIds?: number[];

  @ApiPropertyOptional({
    description: '检查项',
    type: [TaskCheckItemInputDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskCheckItemInputDto)
  checkItems?: TaskCheckItemInputDto[];

  @ApiPropertyOptional({
    description: '重复规则',
    enum: TaskRecurrenceType,
    default: TaskRecurrenceType.NONE,
  })
  @IsOptional()
  @IsEnum(TaskRecurrenceType)
  recurrenceType?: TaskRecurrenceType;

  @ApiPropertyOptional({
    description: '重复间隔。custom 表示间隔天数，其他重复规则表示对应单位间隔。',
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  recurrenceInterval?: number;

  @ApiPropertyOptional({
    description: '是否持续提醒',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  continuousReminderEnabled?: boolean;

  @ApiPropertyOptional({
    description: '持续提醒间隔分钟',
    minimum: 5,
    maximum: 1440,
    default: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  continuousReminderIntervalMinutes?: number;
}
