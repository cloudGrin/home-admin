import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import dayjs from 'dayjs';
import { In, IsNull, Repository } from 'typeorm';
import { BusinessException } from '~/common/exceptions/business.exception';
import { PaginationResult } from '~/common/types/pagination.types';
import { DEFAULT_INSURANCE_ATTACHMENT_MAX_SIZE } from '~/config/constants';
import { LoggerService } from '~/shared/logger/logger.service';
import {
  CompleteDirectUploadDto,
  CreateDirectUploadDto,
} from '~/modules/file/dto/direct-upload.dto';
import { FileEntity } from '~/modules/file/entities/file.entity';
import { FileDownloadResult, FileService } from '~/modules/file/services/file.service';
import { UserEntity } from '~/modules/user/entities/user.entity';
import {
  CreateInsurancePolicyDto,
  QueryInsurancePolicyDto,
  UpdateInsurancePolicyDto,
} from '../dto';
import { InsuranceMemberEntity } from '../entities/insurance-member.entity';
import { InsurancePolicyAttachmentEntity } from '../entities/insurance-policy-attachment.entity';
import { InsurancePolicyEntity } from '../entities/insurance-policy.entity';
import {
  InsurancePolicyReminderEntity,
  InsurancePolicyReminderType,
} from '../entities/insurance-policy-reminder.entity';

interface CurrentUserLike {
  id: number;
}

export interface InsuranceFamilyViewItem {
  member: InsuranceMemberEntity;
  policies: InsurancePolicyEntity[];
  policyCount: number;
  nearestEndDate?: string | null;
  nearestPaymentDate?: string | null;
}

const POLICY_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'endDate',
  'nextPaymentDate',
  'name',
]);
const INSURANCE_ATTACHMENT_FILE_OPTIONS = {
  module: 'insurance-policy',
  tags: 'insurance,policy',
  isPublic: false,
  maxSize: DEFAULT_INSURANCE_ATTACHMENT_MAX_SIZE,
} as const;

@Injectable()
export class InsurancePolicyService {
  constructor(
    @InjectRepository(InsuranceMemberEntity)
    private readonly memberRepository: Repository<InsuranceMemberEntity>,
    @InjectRepository(InsurancePolicyEntity)
    private readonly policyRepository: Repository<InsurancePolicyEntity>,
    @InjectRepository(InsurancePolicyAttachmentEntity)
    private readonly attachmentRepository: Repository<InsurancePolicyAttachmentEntity>,
    @InjectRepository(InsurancePolicyReminderEntity)
    private readonly reminderRepository: Repository<InsurancePolicyReminderEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    private readonly fileService: FileService,
    private readonly logger: LoggerService,
  ) {}

  async uploadAttachment(file: Express.Multer.File, user: CurrentUserLike): Promise<FileEntity> {
    return this.fileService.upload(file, INSURANCE_ATTACHMENT_FILE_OPTIONS, user.id);
  }

  createAttachmentDirectUpload(
    dto: CreateDirectUploadDto,
    user: CurrentUserLike,
  ): ReturnType<FileService['createDirectUpload']> {
    return this.fileService.createDirectUpload(
      {
        ...dto,
        module: INSURANCE_ATTACHMENT_FILE_OPTIONS.module,
        tags: INSURANCE_ATTACHMENT_FILE_OPTIONS.tags,
        isPublic: INSURANCE_ATTACHMENT_FILE_OPTIONS.isPublic,
      },
      user.id,
      { maxSize: INSURANCE_ATTACHMENT_FILE_OPTIONS.maxSize },
    );
  }

  async completeAttachmentDirectUpload(dto: CompleteDirectUploadDto): Promise<FileEntity> {
    return this.fileService.completeDirectUpload(dto);
  }

  async createPolicy(
    dto: CreateInsurancePolicyDto,
    user: CurrentUserLike,
  ): Promise<InsurancePolicyEntity> {
    await this.ensureMemberExists(dto.memberId);
    const ownerUserId = dto.ownerUserId ?? user.id;
    await this.ensureUserExists(ownerUserId);
    await this.ensureAttachmentFilesExist(dto.attachmentFileIds);

    const entity = this.policyRepository.create({
      ...this.toPolicyPatch(dto),
      name: this.normalizeRequiredText(dto.name, '保单名称不能为空'),
      memberId: dto.memberId,
      ownerUserId,
      type: dto.type,
    });
    this.ensurePolicyRules(entity);
    const saved = await this.policyRepository.save(entity);
    await this.replaceAttachments(saved.id, dto.attachmentFileIds);
    await this.rebuildPendingReminders(saved);
    this.logger.log(`Created insurance policy "${saved.name}" by user ${user.id}`);
    return saved;
  }

  async findPolicies(
    query: QueryInsurancePolicyDto,
  ): Promise<PaginationResult<InsurancePolicyEntity>> {
    const qb = this.policyRepository
      .createQueryBuilder('policy')
      .leftJoinAndSelect('policy.member', 'member')
      .leftJoinAndSelect('policy.ownerUser', 'ownerUser')
      .leftJoinAndSelect('policy.attachments', 'attachments')
      .leftJoinAndSelect('attachments.file', 'file');

    if (query.includeReminders) {
      qb.leftJoinAndSelect('policy.reminders', 'reminders');
    }

    if (query.memberId) {
      qb.andWhere('policy.memberId = :memberId', { memberId: query.memberId });
    }

    if (query.type) {
      qb.andWhere('policy.type = :type', { type: query.type });
    }

    if (query.keyword) {
      qb.andWhere(
        '(policy.name LIKE :keyword OR policy.company LIKE :keyword OR policy.policyNo LIKE :keyword OR policy.paymentChannel LIKE :keyword OR policy.purchaseChannel LIKE :keyword OR member.name LIKE :keyword)',
        { keyword: `%${query.keyword}%` },
      );
    }

    const sort = query.sort && POLICY_SORT_FIELDS.has(query.sort) ? query.sort : 'endDate';
    qb.orderBy(`policy.${sort}`, query.order ?? 'ASC').addOrderBy('policy.createdAt', 'DESC');

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const [items, totalItems] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const normalizedItems = await Promise.all(
      items.map((policy) => this.normalizePolicyAttachmentFileUrls(policy)),
    );

    return {
      items: normalizedItems,
      meta: {
        totalItems,
        itemCount: normalizedItems.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
      },
    };
  }

  async findPolicy(id: number): Promise<InsurancePolicyEntity> {
    return this.normalizePolicyAttachmentFileUrls(await this.findByIdOrFail(id));
  }

  async findFamilyView(): Promise<InsuranceFamilyViewItem[]> {
    const members = await this.memberRepository.find({
      order: { sort: 'ASC', id: 'ASC' },
    });
    const policies = await this.policyRepository.find({
      relations: ['member', 'ownerUser', 'attachments', 'attachments.file'],
      order: { endDate: 'ASC', createdAt: 'DESC' },
    });
    const normalizedPolicies = await Promise.all(
      policies.map((policy) => this.normalizePolicyAttachmentFileUrls(policy)),
    );
    const policiesByMember = new Map<number, InsurancePolicyEntity[]>();
    normalizedPolicies.forEach((policy) => {
      const list = policiesByMember.get(policy.memberId) ?? [];
      list.push(policy);
      policiesByMember.set(policy.memberId, list);
    });

    return members.map((member) => {
      const memberPolicies = policiesByMember.get(member.id) ?? [];
      return {
        member,
        policies: memberPolicies,
        policyCount: memberPolicies.length,
        nearestEndDate: this.nearestDate(memberPolicies.map((policy) => policy.endDate)),
        nearestPaymentDate: this.nearestDate(
          memberPolicies.map((policy) => policy.nextPaymentDate),
        ),
      };
    });
  }

  async updatePolicy(id: number, dto: UpdateInsurancePolicyDto): Promise<InsurancePolicyEntity> {
    const entity = await this.findByIdOrFail(id);
    const previousReminderFingerprint = this.reminderFingerprint(entity);

    if (dto.memberId !== undefined) {
      await this.ensureMemberExists(dto.memberId);
      entity.memberId = dto.memberId;
    }
    if (dto.ownerUserId !== undefined) {
      await this.ensureUserExists(dto.ownerUserId);
      entity.ownerUserId = dto.ownerUserId;
    }
    if (dto.attachmentFileIds !== undefined) {
      await this.ensureAttachmentFilesExist(dto.attachmentFileIds);
    }

    Object.assign(entity, this.toPolicyPatch(dto));
    if (dto.name !== undefined) {
      entity.name = this.normalizeRequiredText(dto.name, '保单名称不能为空');
    }
    if (dto.type !== undefined) {
      entity.type = dto.type;
    }
    this.ensurePolicyRules(entity);

    const saved = await this.policyRepository.save(entity);
    if (dto.attachmentFileIds !== undefined) {
      await this.replaceAttachments(saved.id, dto.attachmentFileIds);
    }
    if (this.reminderFingerprint(saved) !== previousReminderFingerprint) {
      await this.rebuildPendingReminders(saved);
    }

    return saved;
  }

  async removePolicy(id: number): Promise<void> {
    await this.findByIdOrFail(id);
    const result = await this.policyRepository.softDelete(id);
    if (!result.affected) {
      throw BusinessException.notFound('Insurance policy', id);
    }
  }

  async getAttachmentDownload(policyId: number, fileId: number): Promise<FileDownloadResult> {
    await this.findByIdOrFail(policyId);

    const attachment = await this.attachmentRepository.findOne({
      where: { policyId, fileId },
      relations: ['file'],
    });
    if (!attachment?.file) {
      throw BusinessException.notFound('Insurance policy attachment', fileId);
    }

    return this.fileService.getDownloadResult(fileId, 'attachment');
  }

  private async findByIdOrFail(id: number): Promise<InsurancePolicyEntity> {
    const entity = await this.policyRepository.findOne({
      where: { id },
      relations: ['member', 'ownerUser', 'attachments', 'attachments.file', 'reminders'],
    });
    if (!entity) {
      throw BusinessException.notFound('Insurance policy', id);
    }

    return entity;
  }

  private async normalizePolicyAttachmentFileUrls(
    policy: InsurancePolicyEntity,
  ): Promise<InsurancePolicyEntity> {
    if (!policy.attachments?.length) {
      return policy;
    }

    await Promise.all(
      policy.attachments.map(async (attachment) => {
        if (attachment.file) {
          attachment.file = await this.fileService.normalizePublicAccessUrl(attachment.file);
        }
      }),
    );

    return policy;
  }

  private toPolicyPatch(dto: Partial<CreateInsurancePolicyDto>): Partial<InsurancePolicyEntity> {
    const patch: Partial<InsurancePolicyEntity> = {};
    for (const key of [
      'company',
      'policyNo',
      'paymentChannel',
      'purchaseChannel',
      'remark',
    ] as const) {
      if (dto[key] !== undefined) {
        (patch as any)[key] = this.normalizeOptionalText(dto[key]);
      }
    }
    for (const key of ['effectiveDate', 'endDate', 'nextPaymentDate'] as const) {
      if (dto[key] !== undefined) {
        (patch as any)[key] = this.normalizeDate(dto[key]);
      }
    }
    if (dto.paymentAmount !== undefined) {
      patch.paymentAmount = dto.paymentAmount ?? null;
    }
    if (dto.paymentFrequency !== undefined) {
      patch.paymentFrequency = dto.paymentFrequency ?? null;
    }
    if (dto.paymentReminderEnabled !== undefined) {
      patch.paymentReminderEnabled = dto.paymentReminderEnabled;
    }

    return patch;
  }

  private async ensureMemberExists(memberId: number): Promise<void> {
    const member = await this.memberRepository.findOne({ where: { id: memberId } });
    if (!member) {
      throw BusinessException.notFound('Insurance member', memberId);
    }
  }

  private async ensureUserExists(userId: number): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw BusinessException.notFound('User', userId);
    }
  }

  private async ensureAttachmentFilesExist(fileIds?: number[]): Promise<void> {
    const ids = this.uniqueIds(fileIds);
    if (ids.length === 0) {
      return;
    }

    const files = await this.fileRepository.find({ where: { id: In(ids) } });
    const existingIds = new Set(files.map((file) => file.id));
    const missingIds = ids.filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      throw BusinessException.validationFailed(`以下附件不存在：${missingIds.join(', ')}`);
    }
  }

  private async replaceAttachments(policyId: number, fileIds?: number[]): Promise<void> {
    const ids = this.uniqueIds(fileIds);
    await this.attachmentRepository.delete({ policyId });
    if (ids.length === 0) {
      return;
    }

    await this.attachmentRepository.save(
      ids.map((fileId, index) =>
        this.attachmentRepository.create({
          policyId,
          fileId,
          sort: index,
        }),
      ),
    );
  }

  private async rebuildPendingReminders(policy: InsurancePolicyEntity): Promise<void> {
    await this.reminderRepository.delete({ policyId: policy.id, sentAt: IsNull() as any });
    const sentReminderKeys = this.getSentReminderKeys(policy);
    const reminders = this.buildReminderEntities(policy).filter(
      (reminder) => !sentReminderKeys.has(this.reminderKey(reminder)),
    );
    if (reminders.length === 0) {
      return;
    }

    await this.reminderRepository.save(reminders);
  }

  private buildReminderEntities(policy: InsurancePolicyEntity): InsurancePolicyReminderEntity[] {
    const reminders: Array<{ type: InsurancePolicyReminderType; date?: string | null }> = [
      {
        type: InsurancePolicyReminderType.EXPIRY_30D,
        date: this.subtractDays(policy.endDate, 30),
      },
      {
        type: InsurancePolicyReminderType.EXPIRY_7D,
        date: this.subtractDays(policy.endDate, 7),
      },
    ];

    if (policy.paymentReminderEnabled !== false) {
      reminders.push(
        {
          type: InsurancePolicyReminderType.PAYMENT_7D,
          date: this.subtractDays(policy.nextPaymentDate, 7),
        },
        {
          type: InsurancePolicyReminderType.PAYMENT_DUE,
          date: policy.nextPaymentDate,
        },
      );
    }

    return reminders
      .filter((item): item is { type: InsurancePolicyReminderType; date: string } =>
        Boolean(item.date),
      )
      .map((item) =>
        this.reminderRepository.create({
          policyId: policy.id,
          reminderType: item.type,
          remindDate: item.date,
          recipientUserId: policy.ownerUserId,
        }),
      );
  }

  private getSentReminderKeys(policy: InsurancePolicyEntity): Set<string> {
    return new Set(
      (policy.reminders ?? [])
        .filter((reminder) => reminder.sentAt)
        .map((reminder) => this.reminderKey(reminder)),
    );
  }

  private reminderKey(
    reminder: Pick<InsurancePolicyReminderEntity, 'reminderType' | 'remindDate'>,
  ) {
    return `${reminder.reminderType}|${reminder.remindDate}`;
  }

  private subtractDays(value: string | null | undefined, days: number): string | null {
    if (!value) {
      return null;
    }

    return dayjs(value).subtract(days, 'day').format('YYYY-MM-DD');
  }

  private ensurePolicyRules(policy: InsurancePolicyEntity): void {
    if (
      policy.effectiveDate &&
      policy.endDate &&
      dayjs(policy.effectiveDate).isAfter(dayjs(policy.endDate), 'day')
    ) {
      throw BusinessException.validationFailed('生效日期不能晚于到期日期');
    }
  }

  private reminderFingerprint(policy: InsurancePolicyEntity): string {
    return [
      policy.endDate ?? '',
      policy.nextPaymentDate ?? '',
      policy.paymentReminderEnabled === false ? '0' : '1',
      policy.ownerUserId,
    ].join('|');
  }

  private normalizeRequiredText(value: string, message: string): string {
    const text = value.trim();
    if (!text) {
      throw BusinessException.validationFailed(message);
    }

    return text;
  }

  private normalizeOptionalText(value?: string | null): string | null {
    const text = value?.trim();
    return text || null;
  }

  private normalizeDate(value?: string | null): string | null {
    if (!value) {
      return null;
    }

    return dayjs(value).format('YYYY-MM-DD');
  }

  private uniqueIds(values?: number[]): number[] {
    return Array.from(
      new Set((values ?? []).filter((value) => Number.isInteger(value) && value > 0)),
    );
  }

  private nearestDate(values: Array<string | null | undefined>): string | null {
    const today = dayjs().startOf('day');
    const futureDates = values
      .filter((value): value is string => Boolean(value))
      .filter((value) => !dayjs(value).isBefore(today, 'day'))
      .sort((left, right) => dayjs(left).valueOf() - dayjs(right).valueOf());

    return futureDates[0] ?? null;
  }
}
