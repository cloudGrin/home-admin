import 'reflect-metadata';
import { InsurancePolicyController } from './insurance-policy.controller';

describe('InsurancePolicyController', () => {
  const createController = () => {
    const policyService = {
      getAttachmentDownload: jest.fn(),
    };

    return {
      controller: new InsurancePolicyController(policyService as any),
      policyService,
    };
  };

  const createResponse = () => ({
    setHeader: jest.fn(),
    redirect: jest.fn(),
  });

  it('redirects OSS attachment downloads to the signed object URL returned by the service', async () => {
    const { controller, policyService } = createController();
    const res = createResponse();
    policyService.getAttachmentDownload.mockResolvedValue({
      file: {
        originalName: 'policy.pdf',
        mimeType: 'application/pdf',
      },
      redirectUrl: 'https://cdn.example.com/policy.pdf?Signature=abc',
    });

    await controller.downloadAttachment(88, 21, res as any);

    expect(policyService.getAttachmentDownload).toHaveBeenCalledWith(88, 21);
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://cdn.example.com/policy.pdf?Signature=abc',
    );
    expect(res.setHeader).not.toHaveBeenCalledWith('Content-Type', expect.any(String));
  });
});
