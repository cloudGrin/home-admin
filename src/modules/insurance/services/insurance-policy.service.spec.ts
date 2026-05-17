import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from '~/common/exceptions/business.exception';
import { DEFAULT_INSURANCE_ATTACHMENT_MAX_SIZE } from '~/config/constants';
import { UserEntity } from '~/modules/user/entities/user.entity';
import { createMockLogger, createMockRepository } from '~/test-utils';
import { LoggerService } from '~/shared/logger/logger.service';
import { FileEntity } from '~/modules/file/entities/file.entity';
import { FileService } from '~/modules/file/services/file.service';
import { InsuranceMemberEntity } from '../entities/insurance-member.entity';
import { InsurancePolicyEntity, InsurancePolicyType } from '../entities/insurance-policy.entity';
import {
  InsurancePolicyReminderEntity,
  InsurancePolicyReminderType,
} from '../entities/insurance-policy-reminder.entity';
import { InsurancePolicyAttachmentEntity } from '../entities/insurance-policy-attachment.entity';
import { InsurancePolicyService } from './insurance-policy.service';

describe('InsurancePolicyService', () => {
  let service: InsurancePolicyService;
  let memberRepository: jest.Mocked<Repository<InsuranceMemberEntity>>;
  let policyRepository: jest.Mocked<Repository<InsurancePolicyEntity>>;
  let attachmentRepository: jest.Mocked<Repository<InsurancePolicyAttachmentEntity>>;
  let reminderRepository: jest.Mocked<Repository<InsurancePolicyReminderEntity>>;
  let userRepository: jest.Mocked<Repository<UserEntity>>;
  let fileRepository: jest.Mocked<Repository<FileEntity>>;
  let fileService: jest.Mocked<FileService>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01T00:00:00.000Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsurancePolicyService,
        {
          provide: getRepositoryToken(InsuranceMemberEntity),
          useValue: createMockRepository<InsuranceMemberEntity>(),
        },
        {
          provide: getRepositoryToken(InsurancePolicyEntity),
          useValue: createMockRepository<InsurancePolicyEntity>(),
        },
        {
          provide: getRepositoryToken(InsurancePolicyAttachmentEntity),
          useValue: createMockRepository<InsurancePolicyAttachmentEntity>(),
        },
        {
          provide: getRepositoryToken(InsurancePolicyReminderEntity),
          useValue: createMockRepository<InsurancePolicyReminderEntity>(),
        },
        { provide: getRepositoryToken(UserEntity), useValue: createMockRepository<UserEntity>() },
        { provide: getRepositoryToken(FileEntity), useValue: createMockRepository<FileEntity>() },
        {
          provide: FileService,
          useValue: {
            upload: jest.fn(),
            createDirectUpload: jest.fn(),
            completeDirectUpload: jest.fn(),
            getDownloadResult: jest.fn(),
            normalizePublicAccessUrl: jest.fn(async (file: FileEntity) => file),
          },
        },
        { provide: LoggerService, useValue: createMockLogger() },
      ],
    }).compile();

    service = module.get(InsurancePolicyService);
    memberRepository = module.get(getRepositoryToken(InsuranceMemberEntity));
    policyRepository = module.get(getRepositoryToken(InsurancePolicyEntity));
    attachmentRepository = module.get(getRepositoryToken(InsurancePolicyAttachmentEntity));
    reminderRepository = module.get(getRepositoryToken(InsurancePolicyReminderEntity));
    userRepository = module.get(getRepositoryToken(UserEntity));
    fileRepository = module.get(getRepositoryToken(FileEntity));
    fileService = module.get(FileService);

    policyRepository.create.mockImplementation((data) => data as InsurancePolicyEntity);
    policyRepository.save.mockImplementation(async (data) =>
      Object.assign(new InsurancePolicyEntity(), data, { id: 88 }),
    );
    attachmentRepository.create.mockImplementation(
      (data) => data as InsurancePolicyAttachmentEntity,
    );
    reminderRepository.create.mockImplementation((data) => data as InsurancePolicyReminderEntity);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('loads policy reminders in list queries only when requested', async () => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    policyRepository.createQueryBuilder.mockReturnValue(qb as any);

    await service.findPolicies({ includeReminders: true } as any);

    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('policy.reminders', 'reminders');
  });

  it('searches payment and purchase metadata by keyword', async () => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    policyRepository.createQueryBuilder.mockReturnValue(qb as any);

    await service.findPolicies({ keyword: '自动扣费' } as any);

    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('policy.paymentChannel LIKE :keyword'),
      { keyword: '%自动扣费%' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('policy.purchaseChannel LIKE :keyword'),
      { keyword: '%自动扣费%' },
    );
  });

  it('creates policy reminders for expiry and payment milestones', async () => {
    memberRepository.findOne.mockResolvedValue(
      Object.assign(new InsuranceMemberEntity(), { id: 3 }),
    );
    userRepository.findOne.mockResolvedValue(Object.assign(new UserEntity(), { id: 7 }));
    fileRepository.find.mockResolvedValue([Object.assign(new FileEntity(), { id: 21 })]);

    const policy = await service.createPolicy(
      {
        name: '家庭百万医疗',
        company: '平安保险',
        policyNo: 'P-2026-001',
        memberId: 3,
        type: InsurancePolicyType.MEDICAL,
        effectiveDate: '2026-05-10',
        endDate: '2026-12-31',
        nextPaymentDate: '2026-08-15',
        paymentAmount: 1200,
        ownerUserId: 7,
        attachmentFileIds: [21],
      },
      { id: 1 } as any,
    );

    expect(policy.id).toBe(88);
    expect(attachmentRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({ policyId: 88, fileId: 21, sort: 0 }),
    ]);
    expect(reminderRepository.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          policyId: 88,
          reminderType: InsurancePolicyReminderType.EXPIRY_30D,
          remindDate: '2026-12-01',
          recipientUserId: 7,
        }),
        expect.objectContaining({
          policyId: 88,
          reminderType: InsurancePolicyReminderType.EXPIRY_7D,
          remindDate: '2026-12-24',
          recipientUserId: 7,
        }),
        expect.objectContaining({
          policyId: 88,
          reminderType: InsurancePolicyReminderType.PAYMENT_7D,
          remindDate: '2026-08-08',
          recipientUserId: 7,
        }),
        expect.objectContaining({
          policyId: 88,
          reminderType: InsurancePolicyReminderType.PAYMENT_DUE,
          remindDate: '2026-08-15',
          recipientUserId: 7,
        }),
      ]),
    );
  });

  it('normalizes public attachment file URLs when reading a policy', async () => {
    const file = Object.assign(new FileEntity(), {
      id: 21,
      originalName: 'invoice.jpg',
      url: 'https://oss.example.com/invoice.jpg',
    });
    const normalizedFile = Object.assign(new FileEntity(), {
      ...file,
      url: '/api/v1/files/21/public',
    });
    const policy = Object.assign(new InsurancePolicyEntity(), {
      id: 88,
      name: '家庭百万医疗',
      attachments: [
        Object.assign(new InsurancePolicyAttachmentEntity(), {
          policyId: 88,
          fileId: 21,
          file,
        }),
      ],
    });
    policyRepository.findOne.mockResolvedValue(policy);
    fileService.normalizePublicAccessUrl.mockResolvedValueOnce(normalizedFile);

    const result = await service.findPolicy(88);

    expect(fileService.normalizePublicAccessUrl).toHaveBeenCalledWith(file);
    expect(result.attachments?.[0].file?.url).toBe('/api/v1/files/21/public');
  });

  it('stores policy payment metadata when creating a policy', async () => {
    memberRepository.findOne.mockResolvedValue(
      Object.assign(new InsuranceMemberEntity(), { id: 3 }),
    );
    userRepository.findOne.mockResolvedValue(Object.assign(new UserEntity(), { id: 7 }));

    const policy = await service.createPolicy(
      {
        name: '家庭百万医疗',
        memberId: 3,
        type: InsurancePolicyType.MEDICAL,
        paymentAmount: 128,
        paymentFrequency: 'monthly',
        paymentChannel: '银行卡自动扣费',
        purchaseChannel: '保险经纪人',
        paymentReminderEnabled: false,
        ownerUserId: 7,
      } as any,
      { id: 1 } as any,
    );

    expect((policy as any).paymentFrequency).toBe('monthly');
    expect((policy as any).paymentChannel).toBe('银行卡自动扣费');
    expect((policy as any).purchaseChannel).toBe('保险经纪人');
    expect((policy as any).paymentReminderEnabled).toBe(false);
  });

  it('omits payment reminders when renewal reminders are disabled', async () => {
    memberRepository.findOne.mockResolvedValue(
      Object.assign(new InsuranceMemberEntity(), { id: 3 }),
    );
    userRepository.findOne.mockResolvedValue(Object.assign(new UserEntity(), { id: 7 }));

    await service.createPolicy(
      {
        name: '家庭百万医疗',
        memberId: 3,
        type: InsurancePolicyType.MEDICAL,
        endDate: '2026-12-31',
        nextPaymentDate: '2026-08-15',
        paymentReminderEnabled: false,
        ownerUserId: 7,
      } as any,
      { id: 1 } as any,
    );

    const reminders = reminderRepository.save.mock.calls[0][0] as InsurancePolicyReminderEntity[];
    expect(reminders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reminderType: InsurancePolicyReminderType.EXPIRY_30D }),
        expect.objectContaining({ reminderType: InsurancePolicyReminderType.EXPIRY_7D }),
      ]),
    );
    expect(reminders).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reminderType: InsurancePolicyReminderType.PAYMENT_7D }),
        expect.objectContaining({ reminderType: InsurancePolicyReminderType.PAYMENT_DUE }),
      ]),
    );
  });

  it('rejects unknown attachment ids before saving a policy', async () => {
    memberRepository.findOne.mockResolvedValue(
      Object.assign(new InsuranceMemberEntity(), { id: 3 }),
    );
    userRepository.findOne.mockResolvedValue(Object.assign(new UserEntity(), { id: 7 }));
    fileRepository.find.mockResolvedValue([]);

    await expect(
      service.createPolicy(
        {
          name: '家庭百万医疗',
          memberId: 3,
          type: InsurancePolicyType.MEDICAL,
          ownerUserId: 7,
          attachmentFileIds: [404],
        },
        { id: 1 } as any,
      ),
    ).rejects.toThrow(BusinessException);
    expect(policyRepository.save).not.toHaveBeenCalled();
  });

  it('uploads policy attachments with the insurance attachment size limit', async () => {
    const file = {
      originalname: 'policy-contract.pdf',
      mimetype: 'application/pdf',
      size: 80 * 1024 * 1024,
      buffer: Buffer.from('contract'),
    } as Express.Multer.File;
    const uploaded = Object.assign(new FileEntity(), { id: 21 });
    fileService.upload.mockResolvedValueOnce(uploaded);

    await expect(service.uploadAttachment(file, { id: 1 } as any)).resolves.toBe(uploaded);

    expect(fileService.upload).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        module: 'insurance-policy',
        tags: 'insurance,policy',
        isPublic: false,
        maxSize: DEFAULT_INSURANCE_ATTACHMENT_MAX_SIZE,
      }),
      1,
    );
  });

  it('creates policy attachment direct uploads with the insurance attachment size limit', async () => {
    const initResult = {
      method: 'PUT' as const,
      uploadUrl: 'https://oss.example.com/policy-contract.pdf',
      uploadToken: 'token-1',
      expiresAt: '2026-05-01T00:15:00.000Z',
      headers: { 'Content-Type': 'application/pdf' },
    };
    fileService.createDirectUpload.mockResolvedValueOnce(initResult);

    await expect(
      service.createAttachmentDirectUpload(
        {
          originalName: 'policy-contract.pdf',
          mimeType: 'application/pdf',
          size: 80 * 1024 * 1024,
        },
        { id: 1 } as any,
      ),
    ).resolves.toBe(initResult);

    expect(fileService.createDirectUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: 'policy-contract.pdf',
        mimeType: 'application/pdf',
        module: 'insurance-policy',
        tags: 'insurance,policy',
        isPublic: false,
      }),
      1,
      { maxSize: DEFAULT_INSURANCE_ATTACHMENT_MAX_SIZE },
    );
  });

  it('rebuilds pending reminders when the policy owner changes', async () => {
    policyRepository.findOne.mockResolvedValue(
      Object.assign(new InsurancePolicyEntity(), {
        id: 88,
        name: '家庭百万医疗',
        memberId: 3,
        type: InsurancePolicyType.MEDICAL,
        ownerUserId: 7,
        endDate: '2026-12-31',
        nextPaymentDate: '2026-08-15',
        reminders: [],
      }),
    );
    userRepository.findOne.mockResolvedValue(Object.assign(new UserEntity(), { id: 9 }));
    policyRepository.save.mockImplementationOnce(async (data) => data as InsurancePolicyEntity);

    await service.updatePolicy(88, { ownerUserId: 9 });

    expect(reminderRepository.delete).toHaveBeenCalledWith(
      expect.objectContaining({ policyId: 88 }),
    );
    expect(reminderRepository.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          reminderType: InsurancePolicyReminderType.EXPIRY_30D,
          recipientUserId: 9,
        }),
        expect.objectContaining({
          reminderType: InsurancePolicyReminderType.PAYMENT_DUE,
          recipientUserId: 9,
        }),
      ]),
    );
  });

  it('does not recreate reminders that have already been sent', async () => {
    policyRepository.findOne.mockResolvedValue(
      Object.assign(new InsurancePolicyEntity(), {
        id: 88,
        name: '家庭百万医疗',
        memberId: 3,
        type: InsurancePolicyType.MEDICAL,
        ownerUserId: 7,
        endDate: '2026-12-31',
        nextPaymentDate: '2026-08-15',
        reminders: [
          Object.assign(new InsurancePolicyReminderEntity(), {
            policyId: 88,
            reminderType: InsurancePolicyReminderType.PAYMENT_DUE,
            remindDate: '2026-08-15',
            sentAt: new Date('2026-08-15T00:00:00.000Z'),
          }),
        ],
      }),
    );
    policyRepository.save.mockImplementationOnce(async (data) => data as InsurancePolicyEntity);

    await service.updatePolicy(88, {
      endDate: '2027-12-31',
    });
    const savedReminders = reminderRepository.save.mock
      .calls[0][0] as InsurancePolicyReminderEntity[];
    expect(savedReminders).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reminderType: InsurancePolicyReminderType.PAYMENT_DUE,
          remindDate: '2026-08-15',
        }),
      ]),
    );
  });

  it('rejects attachment downloads when the policy has been soft-deleted', async () => {
    policyRepository.findOne.mockResolvedValue(null);
    attachmentRepository.findOne.mockResolvedValue(
      Object.assign(new InsurancePolicyAttachmentEntity(), {
        policyId: 88,
        fileId: 21,
        file: Object.assign(new FileEntity(), { id: 21 }),
      }),
    );

    await expect(service.getAttachmentDownload(88, 21)).rejects.toThrow(BusinessException);
    expect(attachmentRepository.findOne).not.toHaveBeenCalled();
    expect(fileService.getDownloadResult).not.toHaveBeenCalled();
  });

  it('returns the file service download result after confirming the attachment belongs to the policy', async () => {
    const policy = Object.assign(new InsurancePolicyEntity(), { id: 88 });
    const file = Object.assign(new FileEntity(), {
      id: 21,
      originalName: 'policy.pdf',
      mimeType: 'application/pdf',
    });
    const download = {
      file,
      redirectUrl: 'https://cdn.example.com/policy.pdf?Signature=abc',
      disposition: 'attachment' as const,
    };
    policyRepository.findOne.mockResolvedValue(policy);
    attachmentRepository.findOne.mockResolvedValue(
      Object.assign(new InsurancePolicyAttachmentEntity(), {
        policyId: 88,
        fileId: 21,
        file,
      }),
    );
    fileService.getDownloadResult.mockResolvedValue(download);

    await expect(service.getAttachmentDownload(88, 21)).resolves.toBe(download);
    expect(fileService.getDownloadResult).toHaveBeenCalledWith(21, 'attachment');
  });
});
