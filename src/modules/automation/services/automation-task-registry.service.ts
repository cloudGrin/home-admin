import { Injectable, OnModuleInit } from '@nestjs/common';
import { AuthService } from '~/modules/auth/services/auth.service';
import { FileCleanupService } from '~/modules/file/services/file-cleanup.service';
import { InsuranceReminderService } from '~/modules/insurance/services/insurance-reminder.service';
import { TaskReminderService } from '~/modules/task/services/task-reminder.service';
import { AutomationTaskDefinition, AutomationTaskParams } from '../types/automation-task.types';

const FILE_CLEANUP_DEFAULT_PARAMS = {
  fileOlderThanHours: 168,
  ossObjectOlderThanHours: 24,
  limit: 100,
};

function ensureObjectParams(params: AutomationTaskParams): AutomationTaskParams {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {};
  }

  return params;
}

function positiveInt(value: unknown, fallback: number, max?: number): number {
  const numberValue = Number(value);
  const normalized = Number.isInteger(numberValue) && numberValue > 0 ? numberValue : fallback;

  return max ? Math.min(max, normalized) : normalized;
}

function normalizeFileCleanupParams(params: AutomationTaskParams): AutomationTaskParams {
  const source = ensureObjectParams(params);

  return {
    fileOlderThanHours: positiveInt(
      source.fileOlderThanHours,
      FILE_CLEANUP_DEFAULT_PARAMS.fileOlderThanHours,
    ),
    ossObjectOlderThanHours: positiveInt(
      source.ossObjectOlderThanHours,
      FILE_CLEANUP_DEFAULT_PARAMS.ossObjectOlderThanHours,
    ),
    limit: positiveInt(source.limit, FILE_CLEANUP_DEFAULT_PARAMS.limit, 500),
  };
}

@Injectable()
export class AutomationTaskRegistryService implements OnModuleInit {
  private readonly definitions = new Map<string, AutomationTaskDefinition>();

  constructor(
    private readonly authService: AuthService,
    private readonly taskReminderService: TaskReminderService,
    private readonly insuranceReminderService: InsuranceReminderService,
    private readonly fileCleanupService: FileCleanupService,
  ) {}

  onModuleInit(): void {
    this.register({
      key: 'cleanupExpiredRefreshTokens',
      name: '清理过期刷新令牌',
      description: '删除已经过期的 refresh token 记录',
      defaultCron: '0 3 * * *',
      defaultEnabled: true,
      defaultParams: {},
      validateParams: ensureObjectParams,
      handler: async () => {
        const count = await this.authService.cleanupExpiredTokens();
        return { message: `清理 ${count} 条过期刷新令牌` };
      },
    });

    this.register({
      key: 'sendTaskReminders',
      name: '发送任务提醒',
      description: '扫描到期提醒并发送站内或外部通知',
      defaultCron: '*/1 * * * *',
      defaultEnabled: true,
      defaultParams: {},
      validateParams: ensureObjectParams,
      handler: async () => {
        const sent = await this.taskReminderService.sendDueReminders();
        return { message: `发送 ${sent} 条任务提醒` };
      },
    });

    this.register({
      key: 'sendInsuranceReminders',
      name: '发送保险提醒',
      description: '扫描到期保险提醒并发送站内或外部通知',
      defaultCron: '0 8 * * *',
      defaultEnabled: true,
      defaultParams: {},
      validateParams: ensureObjectParams,
      handler: async () => {
        const sent = await this.insuranceReminderService.sendDueReminders();
        return { message: `发送 ${sent} 条保险提醒` };
      },
    });

    this.register({
      key: 'scanFileCleanupCandidates',
      name: '扫描文件清理候选',
      description: '扫描 DB 孤儿文件和 OSS 未登记对象，仅生成待人工确认的清理候选',
      defaultCron: '30 4 * * *',
      defaultEnabled: true,
      defaultParams: FILE_CLEANUP_DEFAULT_PARAMS,
      validateParams: normalizeFileCleanupParams,
      handler: async (params) => {
        const normalized = normalizeFileCleanupParams(params);
        const result = await this.fileCleanupService.scanCandidates(normalized);
        return {
          message: `发现 ${result.scanned} 个候选，新增 ${result.created} 个，刷新 ${result.refreshed} 个，过期 ${result.stale} 个`,
          metadata: { ...result },
        };
      },
    });
  }

  getDefinitions(): AutomationTaskDefinition[] {
    return Array.from(this.definitions.values());
  }

  getDefinitionOrThrow(taskKey: string): AutomationTaskDefinition {
    const definition = this.definitions.get(taskKey);
    if (!definition) {
      throw new Error(`自动化任务未注册: ${taskKey}`);
    }

    return definition;
  }

  private register(definition: AutomationTaskDefinition): void {
    if (this.definitions.has(definition.key)) {
      throw new Error(`自动化任务重复注册: ${definition.key}`);
    }

    this.definitions.set(definition.key, definition);
  }
}
