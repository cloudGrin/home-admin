import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { BusinessException } from '~/common/exceptions/business.exception';
import { PaginationResult } from '~/common/types/pagination.types';
import { FileUtil } from '~/common/utils';
import { UserStatus } from '~/common/enums/user.enum';
import { DEFAULT_FAMILY_MEDIA_MAX_SIZE } from '~/config/constants';
import { FileEntity, FileStorageType } from '~/modules/file/entities/file.entity';
import {
  OSS_IMAGE_FEED_PROCESS,
  OSS_IMAGE_PREVIEW_PROCESS,
} from '~/modules/file/image-process.constants';
import { CompleteDirectUploadDto } from '~/modules/file/dto/direct-upload.dto';
import { FileService } from '~/modules/file/services/file.service';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationType,
} from '~/modules/notification/entities/notification.entity';
import { NotificationService } from '~/modules/notification/services/notification.service';
import { AuthenticatedUser } from '~/modules/auth/strategies/jwt.strategy';
import { UserEntity } from '~/modules/user/entities/user.entity';
import { UserService } from '~/modules/user/services/user.service';
import { LoggerService } from '~/shared/logger/logger.service';
import {
  CompleteFamilyMediaDirectUploadDto,
  CreateFamilyChatMessageDto,
  CreateFamilyMediaDirectUploadDto,
  CreateFamilyPostCommentDto,
  CreateFamilyPostDto,
  FamilyChatMessageResponseDto,
  FamilyChatMessageCreatedEventDto,
  FamilyMediaResponseDto,
  FamilyPostCreatedEventDto,
  FamilyPostCommentResponseDto,
  FamilyPostResponseDto,
  FamilyUserSummaryDto,
  QueryFamilyChatMessageDto,
  QueryFamilyPostDto,
  UploadFamilyMediaDto,
} from '../dto';
import {
  FAMILY_CHAT_FILE_MODULE,
  FAMILY_CIRCLE_FILE_MODULE,
  FamilyChatMessageEntity,
  FamilyChatMessageMediaEntity,
  FamilyMediaTarget,
  FamilyMediaType,
  FamilyPostCommentEntity,
  FamilyPostEntity,
  FamilyPostLikeEntity,
  FamilyPostMediaEntity,
} from '../entities';
import { FAMILY_PRIVATE_MEDIA_CACHE_MAX_AGE_SECONDS } from '../family-media-cache.constants';
import { FamilyEventService } from './family-event.service';

const FAMILY_VIDEO_POSTER_PROCESS = 'video/snapshot,t_1000,f_jpg,w_720,m_fast';
const FAMILY_IMAGE_ALLOWED_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'];
const FAMILY_VIDEO_ALLOWED_TYPES = ['.mp4', '.mov', '.webm'];
const FAMILY_CHAT_VIDEO_MAX_SIZE = 100 * 1024 * 1024;
const FAMILY_CIRCLE_VIDEO_MAX_SIZE = 200 * 1024 * 1024;
const FAMILY_PUBLIC_POST_PREVIEW_LIMIT = 5;
const FAMILY_POST_RESPONSE_RELATIONS = [
  'author',
  'media',
  'media.file',
  'comments',
  'comments.author',
  'comments.replyToUser',
  'likes',
  'likes.user',
];

type FamilyMediaEntity = FamilyPostMediaEntity | FamilyChatMessageMediaEntity;

@Injectable()
export class FamilyService {
  constructor(
    @InjectRepository(FamilyPostEntity)
    private readonly postRepository: Repository<FamilyPostEntity>,
    @InjectRepository(FamilyPostMediaEntity)
    private readonly postMediaRepository: Repository<FamilyPostMediaEntity>,
    @InjectRepository(FamilyPostLikeEntity)
    private readonly postLikeRepository: Repository<FamilyPostLikeEntity>,
    @InjectRepository(FamilyPostCommentEntity)
    private readonly postCommentRepository: Repository<FamilyPostCommentEntity>,
    @InjectRepository(FamilyChatMessageEntity)
    private readonly chatMessageRepository: Repository<FamilyChatMessageEntity>,
    @InjectRepository(FamilyChatMessageMediaEntity)
    private readonly chatMessageMediaRepository: Repository<FamilyChatMessageMediaEntity>,
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly fileService: FileService,
    private readonly userService: UserService,
    private readonly notificationService: NotificationService,
    private readonly eventService: FamilyEventService,
    private readonly logger: LoggerService,
  ) {}

  async createPost(dto: CreateFamilyPostDto, user: AuthenticatedUser): Promise<FamilyPostEntity> {
    const content = this.normalizeOptionalText(dto.content);
    const mediaFileIds = this.normalizeFileIds(dto.mediaFileIds);
    this.ensureContentOrMedia(content, mediaFileIds, '动态内容不能为空');
    const files = await this.ensureUsableMediaFiles(
      mediaFileIds,
      user.id,
      FAMILY_CIRCLE_FILE_MODULE,
    );

    const post = await this.postRepository.save(
      this.postRepository.create({
        content,
        authorId: user.id,
      }),
    );

    if (files.length > 0) {
      post.media = await this.postMediaRepository.save(
        this.postMediaRepository.create(
          files.map((file, index) => ({
            postId: post.id,
            fileId: file.id,
            mediaType: this.getFamilyMediaType(file),
            sort: index,
          })),
        ),
      );
    }

    await this.notifyFamilyExcept(user.id, {
      title: '新的家庭动态',
      content: this.buildNotificationContent(user.username, content, '发布了新的家庭动态'),
      mobileLink: '/m/family',
      metadata: { module: 'family', kind: 'post', postId: post.id },
    });
    this.eventService.emitPostCreated(await this.toPostCreatedEvent(post, user));
    this.logger.log(`Created family post ${post.id} by user ${user.id}`);

    return post;
  }

  async findPosts(
    query: QueryFamilyPostDto,
    user: AuthenticatedUser,
  ): Promise<PaginationResult<FamilyPostResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = query.afterId ? { id: MoreThan(query.afterId) } : undefined;
    const [items, totalItems] = await this.postRepository.findAndCount({
      where,
      relations: FAMILY_POST_RESPONSE_RELATIONS,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const responseItems = await Promise.all(
      items.map((post) => this.toPostResponse(post, user.id)),
    );

    return this.paginate(responseItems, totalItems, page, limit);
  }

  async findPublicPreviewPosts(): Promise<PaginationResult<FamilyPostResponseDto>> {
    const [items, totalItems] = await this.postRepository.findAndCount({
      relations: FAMILY_POST_RESPONSE_RELATIONS,
      order: { createdAt: 'DESC' },
      skip: 0,
      take: FAMILY_PUBLIC_POST_PREVIEW_LIMIT,
    });
    const responseItems = await Promise.all(items.map((post) => this.toPostResponse(post, null)));

    return this.paginate(responseItems, totalItems, 1, FAMILY_PUBLIC_POST_PREVIEW_LIMIT);
  }

  async findPost(postId: number, user: AuthenticatedUser): Promise<FamilyPostResponseDto> {
    const post = await this.postRepository.findOne({
      where: { id: postId },
      relations: FAMILY_POST_RESPONSE_RELATIONS,
    });
    if (!post) {
      throw BusinessException.notFound('Family post', postId);
    }

    return this.toPostResponse(post, user.id);
  }

  async createComment(
    postId: number,
    dto: CreateFamilyPostCommentDto,
    user: AuthenticatedUser,
  ): Promise<FamilyPostCommentEntity> {
    const contentLength = dto.content?.trim().length ?? 0;
    this.logger.log(
      `[FamilyComment] create requested postId=${postId} userId=${user.id} parentCommentId=${
        dto.parentCommentId ?? 'null'
      } contentLength=${contentLength}`,
      'FamilyService',
    );

    try {
      await this.ensurePostExists(postId);
      const content = this.normalizeRequiredText(dto.content, '评论内容不能为空');
      const parentComment = dto.parentCommentId
        ? await this.ensureCommentBelongsToPost(postId, dto.parentCommentId)
        : null;
      const comment = await this.postCommentRepository.save(
        this.postCommentRepository.create({
          postId,
          authorId: user.id,
          parentCommentId: parentComment?.id,
          replyToUserId: parentComment?.authorId,
          content,
        }),
      );

      this.logger.log(
        `[FamilyComment] create saved postId=${postId} commentId=${comment.id} userId=${
          user.id
        } parentCommentId=${parentComment?.id ?? 'null'} contentLength=${content.length}`,
        'FamilyService',
      );

      await this.notifyFamilyExcept(user.id, {
        title: '新的家庭评论',
        content: this.buildNotificationContent(
          user.username,
          content,
          parentComment ? '回复了家庭评论' : '评论了家庭动态',
        ),
        mobileLink: '/m/family',
        metadata: {
          module: 'family',
          kind: parentComment ? 'comment-reply' : 'comment',
          postId,
          commentId: comment.id,
          parentCommentId: parentComment?.id,
        },
      });
      this.eventService.emitPostCommentCreated(comment);

      return comment;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[FamilyComment] create failed postId=${postId} userId=${user.id} parentCommentId=${
          dto.parentCommentId ?? 'null'
        } contentLength=${contentLength} error=${message}`,
        stack,
        'FamilyService',
      );
      throw error;
    }
  }

  async likePost(postId: number, user: AuthenticatedUser): Promise<{ liked: true }> {
    await this.ensurePostExists(postId);
    const existing = await this.postLikeRepository.findOne({
      where: { postId, userId: user.id },
    });
    if (!existing) {
      await this.postLikeRepository.save(
        this.postLikeRepository.create({
          postId,
          userId: user.id,
        }),
      );
    }

    this.eventService.emitPostLikeChanged({ postId, userId: user.id, liked: true });

    return { liked: true };
  }

  async unlikePost(postId: number, user: AuthenticatedUser): Promise<void> {
    await this.ensurePostExists(postId);
    await this.postLikeRepository.delete({ postId, userId: user.id });
    this.eventService.emitPostLikeChanged({ postId, userId: user.id, liked: false });
  }

  async deletePost(postId: number, user: AuthenticatedUser): Promise<void> {
    const post = await this.ensurePostExists(postId);
    this.ensureCanDeleteFamilyContent(post.authorId, user, '只能删除自己发布的家庭动态');

    const result = await this.postRepository.softDelete(postId);
    if (!result.affected) {
      throw BusinessException.notFound('Family post', postId);
    }

    this.eventService.emitPostDeleted({ postId, authorId: post.authorId });
    this.logger.log(`Deleted family post ${postId} by user ${user.id}`);
  }

  async deleteComment(postId: number, commentId: number, user: AuthenticatedUser): Promise<void> {
    const comment = await this.postCommentRepository.findOne({
      where: { id: commentId, postId },
      relations: ['post'],
    });
    if (!comment) {
      throw BusinessException.notFound('Family post comment', commentId);
    }

    const canDelete =
      this.isSuperAdmin(user) || comment.authorId === user.id || comment.post?.authorId === user.id;
    if (!canDelete) {
      throw BusinessException.forbidden('只能删除自己的评论或自己动态下的评论');
    }

    const result = await this.postCommentRepository.softDelete(commentId);
    if (!result.affected) {
      throw BusinessException.notFound('Family post comment', commentId);
    }

    this.eventService.emitPostCommentDeleted({
      postId,
      commentId,
      authorId: comment.authorId,
    });
  }

  async createChatMessage(
    dto: CreateFamilyChatMessageDto,
    user: AuthenticatedUser,
  ): Promise<FamilyChatMessageEntity> {
    const content = this.normalizeOptionalText(dto.content);
    const mediaFileIds = this.normalizeFileIds(dto.mediaFileIds);
    this.ensureContentOrMedia(content, mediaFileIds, '消息内容不能为空');
    const files = await this.ensureUsableMediaFiles(mediaFileIds, user.id, FAMILY_CHAT_FILE_MODULE);

    const message = await this.chatMessageRepository.save(
      this.chatMessageRepository.create({
        content,
        senderId: user.id,
      }),
    );

    if (files.length > 0) {
      message.media = await this.chatMessageMediaRepository.save(
        this.chatMessageMediaRepository.create(
          files.map((file, index) => ({
            messageId: message.id,
            fileId: file.id,
            mediaType: this.getFamilyMediaType(file),
            sort: index,
          })),
        ),
      );
    }

    await this.notifyFamilyExcept(user.id, {
      title: '新的家庭群聊消息',
      content: this.buildNotificationContent(user.username, content, '发来新的家庭群聊消息'),
      mobileLink: '/m/family/chat',
      metadata: { module: 'family', kind: 'chat-message', messageId: message.id },
    });
    this.eventService.emitChatMessageCreated(await this.toChatMessageCreatedEvent(message, user));

    return message;
  }

  async findChatMessages(
    query: QueryFamilyChatMessageDto,
  ): Promise<PaginationResult<FamilyChatMessageResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where = query.afterId ? { id: MoreThan(query.afterId) } : undefined;
    const [items, totalItems] = await this.chatMessageRepository.findAndCount({
      where,
      relations: ['sender', 'media', 'media.file'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const sorted = [...items].sort((a, b) => a.id - b.id);
    const responseItems = await Promise.all(sorted.map((item) => this.toChatMessageResponse(item)));

    return this.paginate(responseItems, totalItems, page, limit);
  }

  async deleteChatMessage(messageId: number, user: AuthenticatedUser): Promise<void> {
    const message = await this.chatMessageRepository.findOne({ where: { id: messageId } });
    if (!message) {
      throw BusinessException.notFound('Family chat message', messageId);
    }

    this.ensureCanDeleteFamilyContent(message.senderId, user, '只能删除自己发送的群聊消息');

    const result = await this.chatMessageRepository.softDelete(messageId);
    if (!result.affected) {
      throw BusinessException.notFound('Family chat message', messageId);
    }

    this.eventService.emitChatMessageDeleted({
      messageId,
      senderId: message.senderId,
    });
  }

  async createMediaDirectUpload(dto: CreateFamilyMediaDirectUploadDto, user: AuthenticatedUser) {
    const mediaType = this.ensureFamilyMediaMetadata(dto.originalName, dto.mimeType);
    const uploadOptions = this.getFamilyMediaUploadOptions(mediaType, dto.target);
    if (dto.size > uploadOptions.maxSize) {
      throw BusinessException.validationFailed('家庭媒体文件过大');
    }

    const module = this.getFileModule(dto.target);
    return this.fileService.createDirectUpload(
      {
        ...dto,
        module,
        tags: dto.tags || 'family,media',
        isPublic: false,
      },
      user.id,
      uploadOptions,
    );
  }

  async uploadLocalMedia(
    file: Express.Multer.File,
    dto: UploadFamilyMediaDto,
    user: AuthenticatedUser,
  ): Promise<FileEntity> {
    if (!file) {
      throw BusinessException.validationFailed('请选择要上传的文件');
    }

    const mediaType = this.ensureFamilyMediaMetadata(
      file.originalname,
      file.mimetype || 'application/octet-stream',
    );
    if (mediaType === FamilyMediaType.VIDEO) {
      throw BusinessException.validationFailed('本地上传暂不支持家庭视频，请启用 OSS 直传');
    }

    return this.fileService.upload(
      file,
      {
        module: this.getFileModule(dto.target),
        tags: 'family,media',
        isPublic: false,
        storage: FileStorageType.LOCAL,
        ...this.getFamilyMediaUploadOptions(mediaType, dto.target),
      },
      user.id,
    );
  }

  async completeMediaDirectUpload(dto: CompleteFamilyMediaDirectUploadDto): Promise<FileEntity> {
    return this.fileService.completeDirectUpload(dto as CompleteDirectUploadDto);
  }

  async toMediaResponse(media: FamilyMediaEntity[]): Promise<FamilyMediaResponseDto[]> {
    const sorted = [...(media ?? [])].sort((left, right) => left.sort - right.sort);
    return Promise.all(
      sorted.map(async (item) => {
        const file = item.file;
        const link = await this.fileService.createTrustedAccessLink(item.fileId, {
          disposition: 'inline',
          cacheMaxAgeSeconds: FAMILY_PRIVATE_MEDIA_CACHE_MAX_AGE_SECONDS,
          file,
          ...(item.mediaType === FamilyMediaType.IMAGE && file?.storage === FileStorageType.OSS
            ? {
                process: OSS_IMAGE_FEED_PROCESS,
              }
            : {}),
        });
        const previewLink =
          item.mediaType === FamilyMediaType.IMAGE && file?.storage === FileStorageType.OSS
            ? await this.fileService.createTrustedAccessLink(item.fileId, {
                disposition: 'inline',
                cacheMaxAgeSeconds: FAMILY_PRIVATE_MEDIA_CACHE_MAX_AGE_SECONDS,
                process: OSS_IMAGE_PREVIEW_PROCESS,
                file,
              })
            : null;
        const posterLink =
          item.mediaType === FamilyMediaType.VIDEO && file?.storage === FileStorageType.OSS
            ? await this.fileService.createTrustedAccessLink(item.fileId, {
                disposition: 'inline',
                cacheMaxAgeSeconds: FAMILY_PRIVATE_MEDIA_CACHE_MAX_AGE_SECONDS,
                process: FAMILY_VIDEO_POSTER_PROCESS,
                file,
              })
            : null;

        return {
          id: item.id,
          fileId: item.fileId,
          mediaType: item.mediaType,
          sort: item.sort,
          mimeType: file?.mimeType,
          originalName: file?.originalName,
          size: typeof file?.size === 'number' ? file.size : Number(file?.size ?? 0),
          displayUrl: link.url,
          ...(previewLink ? { previewUrl: previewLink.url } : {}),
          ...(posterLink ? { posterUrl: posterLink.url } : {}),
          expiresAt: link.expiresAt,
        };
      }),
    );
  }

  private async toPostResponse(
    post: FamilyPostEntity,
    currentUserId: number | null,
  ): Promise<FamilyPostResponseDto> {
    const comments = [...(post.comments ?? [])].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );

    return {
      id: post.id,
      content: post.content,
      authorId: post.authorId,
      author: await this.toUserSummary(post.author),
      media: await this.toMediaResponse(post.media ?? []),
      comments: await Promise.all(comments.map((comment) => this.toCommentResponse(comment))),
      likeCount: post.likes?.length ?? 0,
      likedByMe: currentUserId
        ? (post.likes ?? []).some((like) => like.userId === currentUserId)
        : false,
      likedUsers: (
        await Promise.all((post.likes ?? []).map((like) => this.toUserSummary(like.user)))
      ).filter((user): user is FamilyUserSummaryDto => Boolean(user)),
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }

  private async toChatMessageResponse(
    message: FamilyChatMessageEntity,
  ): Promise<FamilyChatMessageResponseDto> {
    return {
      id: message.id,
      content: message.content,
      senderId: message.senderId,
      sender: await this.toUserSummary(message.sender),
      media: await this.toMediaResponse(message.media ?? []),
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  private async toCommentResponse(
    comment: FamilyPostCommentEntity,
  ): Promise<FamilyPostCommentResponseDto> {
    const [author, replyToUser] = await Promise.all([
      this.toUserSummary(comment.author),
      this.toUserSummary(comment.replyToUser),
    ]);

    return {
      id: comment.id,
      postId: comment.postId,
      parentCommentId: comment.parentCommentId ?? null,
      replyToUserId: comment.replyToUserId ?? null,
      content: comment.content,
      authorId: comment.authorId,
      author,
      replyToUser: replyToUser ?? null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }

  private async toUserSummary(user?: UserEntity | null): Promise<FamilyUserSummaryDto | undefined> {
    if (!user) {
      return undefined;
    }

    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      realName: user.realName,
      avatar: await this.userService.resolveTrustedAvatarUrl(user.avatar),
    };
  }

  private async toPostCreatedEvent(
    post: FamilyPostEntity,
    user: AuthenticatedUser,
  ): Promise<FamilyPostCreatedEventDto> {
    return {
      postId: post.id,
      authorId: user.id,
      author: await this.toAuthenticatedUserSummary(user),
      createdAt: post.createdAt ?? new Date(),
    };
  }

  private async toChatMessageCreatedEvent(
    message: FamilyChatMessageEntity,
    user: AuthenticatedUser,
  ): Promise<FamilyChatMessageCreatedEventDto> {
    return {
      messageId: message.id,
      senderId: user.id,
      sender: await this.toAuthenticatedUserSummary(user),
      createdAt: message.createdAt ?? new Date(),
    };
  }

  private async toAuthenticatedUserSummary(user: AuthenticatedUser): Promise<FamilyUserSummaryDto> {
    const entity = await this.userRepository.findOne({ where: { id: user.id } });
    return (
      (await this.toUserSummary(entity)) ?? {
        id: user.id,
        username: user.username,
        nickname: null,
        realName: null,
        avatar: null,
      }
    );
  }

  private async ensurePostExists(postId: number): Promise<FamilyPostEntity> {
    const post = await this.postRepository.findOne({ where: { id: postId } });
    if (!post) {
      throw BusinessException.notFound('Family post', postId);
    }

    return post;
  }

  private async ensureCommentBelongsToPost(
    postId: number,
    commentId: number,
  ): Promise<FamilyPostCommentEntity> {
    const comment = await this.postCommentRepository.findOne({
      where: { id: commentId },
      relations: ['author'],
    });
    if (!comment || comment.postId !== postId) {
      throw BusinessException.notFound('Family post comment', commentId);
    }

    return comment;
  }

  private ensureCanDeleteFamilyContent(
    ownerId: number,
    user: AuthenticatedUser,
    message: string,
  ): void {
    if (this.isSuperAdmin(user) || ownerId === user.id) {
      return;
    }

    throw BusinessException.forbidden(message);
  }

  private isSuperAdmin(user: AuthenticatedUser): boolean {
    return (
      user.isSuperAdmin === true ||
      user.roleCode === 'super_admin' ||
      user.roles?.includes('super_admin')
    );
  }

  private async ensureUsableMediaFiles(
    fileIds: number[],
    userId: number,
    module: string,
  ): Promise<FileEntity[]> {
    if (fileIds.length === 0) {
      return [];
    }

    const files = await this.fileRepository.find({ where: { id: In(fileIds) } });
    const fileMap = new Map(files.map((file) => [file.id, file]));
    const orderedFiles = fileIds.map((id) => fileMap.get(id));
    const missingId = fileIds.find((_id, index) => !orderedFiles[index]);
    if (missingId) {
      throw BusinessException.notFound('File', missingId);
    }

    for (const file of orderedFiles as FileEntity[]) {
      if (file.uploaderId !== userId) {
        throw BusinessException.forbidden('只能使用自己上传的家庭媒体');
      }

      if (file.module !== module) {
        throw BusinessException.validationFailed('媒体文件使用场景不匹配');
      }

      if (file.storage !== FileStorageType.OSS && file.storage !== FileStorageType.LOCAL) {
        throw BusinessException.validationFailed('家庭媒体存储类型不支持');
      }

      this.ensureFamilyMediaFile(file);
    }

    return orderedFiles as FileEntity[];
  }

  private ensureFamilyMediaFile(file: FileEntity): void {
    const type = this.getFamilyMediaType(file);
    if (type !== FamilyMediaType.IMAGE && type !== FamilyMediaType.VIDEO) {
      throw BusinessException.validationFailed('家庭媒体仅支持图片和视频');
    }
  }

  private getFamilyMediaType(file: Pick<FileEntity, 'category' | 'mimeType' | 'originalName'>) {
    const mimeType = file.mimeType || '';
    if (file.category === 'image' || mimeType.startsWith('image/')) {
      return FamilyMediaType.IMAGE;
    }

    if (file.category === 'video' || mimeType.startsWith('video/')) {
      return FamilyMediaType.VIDEO;
    }

    if (file.originalName && FileUtil.isImage(file.originalName)) {
      return FamilyMediaType.IMAGE;
    }

    if (file.originalName && FileUtil.isVideo(file.originalName)) {
      return FamilyMediaType.VIDEO;
    }

    throw BusinessException.validationFailed('家庭媒体仅支持图片和视频');
  }

  private ensureFamilyMediaMetadata(originalName: string, mimeType: string): FamilyMediaType {
    const isImage = mimeType.startsWith('image/') || FileUtil.isImage(originalName);
    const isVideo = mimeType.startsWith('video/') || FileUtil.isVideo(originalName);
    if (!isImage && !isVideo) {
      throw BusinessException.validationFailed('家庭媒体仅支持图片和视频');
    }

    if (isVideo) {
      const extension = FileUtil.getExtension(originalName);
      if (!FAMILY_VIDEO_ALLOWED_TYPES.includes(extension)) {
        throw BusinessException.validationFailed('家庭视频仅支持 MP4、MOV、WEBM');
      }
      return FamilyMediaType.VIDEO;
    }

    return FamilyMediaType.IMAGE;
  }

  private getFamilyMediaUploadOptions(
    mediaType: FamilyMediaType,
    target: FamilyMediaTarget,
  ): {
    maxSize: number;
    allowedTypes: string[];
  } {
    if (mediaType === FamilyMediaType.VIDEO) {
      return {
        maxSize:
          target === FamilyMediaTarget.CHAT
            ? FAMILY_CHAT_VIDEO_MAX_SIZE
            : FAMILY_CIRCLE_VIDEO_MAX_SIZE,
        allowedTypes: FAMILY_VIDEO_ALLOWED_TYPES,
      };
    }

    return {
      maxSize: DEFAULT_FAMILY_MEDIA_MAX_SIZE,
      allowedTypes: FAMILY_IMAGE_ALLOWED_TYPES,
    };
  }

  private getFileModule(target: FamilyMediaTarget): string {
    return target === FamilyMediaTarget.CHAT ? FAMILY_CHAT_FILE_MODULE : FAMILY_CIRCLE_FILE_MODULE;
  }

  private normalizeOptionalText(value?: string | null): string | null {
    const text = value?.trim();
    return text || null;
  }

  private normalizeRequiredText(value: string, message: string): string {
    const text = value.trim();
    if (!text) {
      throw BusinessException.validationFailed(message);
    }

    return text;
  }

  private normalizeFileIds(value?: number[]): number[] {
    return Array.from(new Set(value ?? [])).filter((id) => Number.isInteger(id) && id > 0);
  }

  private ensureContentOrMedia(
    content: string | null,
    mediaFileIds: number[],
    message: string,
  ): void {
    if (!content && mediaFileIds.length === 0) {
      throw BusinessException.validationFailed(message);
    }
  }

  private async notifyFamilyExcept(
    senderId: number,
    options: {
      title: string;
      content: string;
      mobileLink: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const recipientIds = await this.findActiveFamilyRecipientIds(senderId);
    if (recipientIds.length === 0) {
      return;
    }

    const notifications = await this.notificationService.createNotification(
      {
        title: options.title,
        content: options.content,
        type: NotificationType.MESSAGE,
        priority: NotificationPriority.NORMAL,
        recipientIds,
        channels: [NotificationChannel.INTERNAL],
        sendExternal: false,
        metadata: {
          ...options.metadata,
          mobileLink: options.mobileLink,
        },
      },
      senderId,
    );
    this.eventService.emitNotificationCreated(notifications);
  }

  private async findActiveFamilyRecipientIds(senderId: number): Promise<number[]> {
    const users = await this.userRepository.find({
      where: { status: UserStatus.ACTIVE },
      select: ['id'],
    });

    return users.map((user) => user.id).filter((id) => id !== senderId);
  }

  private buildNotificationContent(username: string, content: string | null, fallback: string) {
    const text = content?.trim();
    return text ? `${username}: ${text}` : `${username} ${fallback}`;
  }

  private paginate<T>(
    items: T[],
    totalItems: number,
    page: number,
    limit: number,
  ): PaginationResult<T> {
    return {
      items,
      meta: {
        totalItems,
        itemCount: items.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
      },
    };
  }
}
