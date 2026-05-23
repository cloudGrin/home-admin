import { AuthService } from '~/modules/auth/services/auth.service';
import { FileCleanupService } from '~/modules/file/services/file-cleanup.service';
import { InsuranceReminderService } from '~/modules/insurance/services/insurance-reminder.service';
import { TaskReminderService } from '~/modules/task/services/task-reminder.service';
import { AutomationTaskRegistryService } from './automation-task-registry.service';

describe('AutomationTaskRegistryService', () => {
  const createService = () => {
    const authService = {
      cleanupExpiredTokens: jest.fn().mockResolvedValue(0),
    };
    const taskReminderService = {
      sendDueReminders: jest.fn().mockResolvedValue(0),
    };
    const insuranceReminderService = {
      sendDueReminders: jest.fn().mockResolvedValue(0),
    };
    const fileCleanupService = {
      scanCandidates: jest.fn().mockResolvedValue({
        scanned: 2,
        created: 1,
        refreshed: 1,
        stale: 0,
      }),
    };
    const service = new AutomationTaskRegistryService(
      authService as unknown as AuthService,
      taskReminderService as unknown as TaskReminderService,
      insuranceReminderService as unknown as InsuranceReminderService,
      fileCleanupService as unknown as FileCleanupService,
    );
    service.onModuleInit();

    return { service, fileCleanupService };
  };

  it('registers a scan-only file cleanup candidate task', async () => {
    const { service, fileCleanupService } = createService();

    const definition = service.getDefinitionOrThrow('scanFileCleanupCandidates');
    const result = await definition.handler({ limit: 50 });

    expect(definition).toEqual(
      expect.objectContaining({
        key: 'scanFileCleanupCandidates',
        name: '扫描文件清理候选',
        defaultCron: '30 4 * * *',
        defaultEnabled: true,
        defaultParams: {
          fileOlderThanHours: 168,
          ossObjectOlderThanHours: 24,
          limit: 100,
        },
      }),
    );
    expect(fileCleanupService.scanCandidates).toHaveBeenCalledWith({
      fileOlderThanHours: 168,
      ossObjectOlderThanHours: 24,
      limit: 50,
    });
    expect(result?.message).toContain('发现 2 个候选');
  });

  it('normalizes unsafe cleanup scan params before running', () => {
    const { service } = createService();
    const definition = service.getDefinitionOrThrow('scanFileCleanupCandidates');

    expect(
      definition.validateParams?.({
        fileOlderThanHours: -1,
        ossObjectOlderThanHours: 'bad',
        limit: 2000,
      }),
    ).toEqual({
      fileOlderThanHours: 168,
      ossObjectOlderThanHours: 24,
      limit: 500,
    });
  });
});
