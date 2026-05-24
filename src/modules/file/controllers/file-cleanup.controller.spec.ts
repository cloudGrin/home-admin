import 'reflect-metadata';
import { PERMISSIONS_KEY } from '~/core/decorators/require-permissions.decorator';
import { FileCleanupController } from './file-cleanup.controller';

describe('FileCleanupController', () => {
  const createController = () => {
    const service = {
      findCandidates: jest.fn().mockResolvedValue({ items: [], meta: {} }),
      scanCandidates: jest.fn().mockResolvedValue({ created: 1 }),
      createAccessLink: jest.fn().mockResolvedValue({ url: '/preview', expiresAt: '2026-05-21' }),
      deleteCandidates: jest.fn().mockResolvedValue({ deleted: 1 }),
      ignoreCandidates: jest.fn().mockResolvedValue({ updated: 1 }),
    };

    return {
      controller: new FileCleanupController(service as any),
      service,
    };
  };

  it('delegates candidate listing to the cleanup service', async () => {
    const { controller, service } = createController();
    const query = { page: 1, status: 'pending' } as any;

    await controller.findCandidates(query);

    expect(service.findCandidates).toHaveBeenCalledWith(query);
  });

  it('scans candidates without deleting files', async () => {
    const { controller, service } = createController();
    const dto = { limit: 25, fileOlderThanHours: 168, ossObjectOlderThanHours: 24 };

    await controller.scanCandidates(dto);

    expect(service.scanCandidates).toHaveBeenCalledWith(dto);
    expect(service.deleteCandidates).not.toHaveBeenCalled();
  });

  it('passes the current user id when deleting selected candidates', async () => {
    const { controller, service } = createController();

    await controller.deleteCandidates({ ids: [1, 2] }, { id: 7 } as any);

    expect(service.deleteCandidates).toHaveBeenCalledWith([1, 2], 7);
  });

  it('creates a preview access link for one cleanup candidate', async () => {
    const { controller, service } = createController();
    const currentUser = { id: 7, roles: ['family_member'] };

    await controller.createAccessLink(3, currentUser as any);

    expect(service.createAccessLink).toHaveBeenCalledWith(3, currentUser);
  });

  it('uses file permissions for read and destructive actions', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, FileCleanupController.prototype.findCandidates),
    ).toEqual(['file:read']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, FileCleanupController.prototype.scanCandidates),
    ).toEqual(['file:read']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, FileCleanupController.prototype.createAccessLink),
    ).toEqual(['file:delete']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, FileCleanupController.prototype.deleteCandidates),
    ).toEqual(['file:delete']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, FileCleanupController.prototype.ignoreCandidates),
    ).toEqual(['file:delete']);
  });
});
