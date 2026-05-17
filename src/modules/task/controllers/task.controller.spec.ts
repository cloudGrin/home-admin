import 'reflect-metadata';
import { TaskController } from './task.controller';

describe('TaskController', () => {
  const createController = () => {
    const taskService = {
      getAttachmentDownload: jest.fn(),
    };

    return {
      controller: new TaskController(taskService as any),
      taskService,
    };
  };

  const createResponse = () => ({
    setHeader: jest.fn(),
    redirect: jest.fn(),
  });

  it('redirects OSS attachment downloads to the signed object URL returned by the service', async () => {
    const { controller, taskService } = createController();
    const res = createResponse();
    taskService.getAttachmentDownload.mockResolvedValue({
      file: {
        originalName: 'materials.pdf',
        mimeType: 'application/pdf',
      },
      redirectUrl: 'https://cdn.example.com/materials.pdf?Signature=abc',
    });

    await controller.downloadAttachment(77, 21, { id: 1 } as any, res as any);

    expect(taskService.getAttachmentDownload).toHaveBeenCalledWith(77, 21, { id: 1 });
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://cdn.example.com/materials.pdf?Signature=abc',
    );
    expect(res.setHeader).not.toHaveBeenCalledWith('Content-Type', expect.any(String));
  });
});
