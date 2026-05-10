import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from '~/common/exceptions/business.exception';
import { createMockLogger, createMockRepository } from '~/test-utils';
import { FileEntity, FileStorageType } from '~/modules/file/entities/file.entity';
import { FileService } from '~/modules/file/services/file.service';
import { NotificationService } from '~/modules/notification/services/notification.service';
import { UserEntity } from '~/modules/user/entities/user.entity';
import { LoggerService } from '~/shared/logger/logger.service';
import { FamilyChatMessageMediaEntity } from '../entities/family-chat-message-media.entity';
import { FamilyChatMessageEntity } from '../entities/family-chat-message.entity';
import { FamilyPostCommentEntity } from '../entities/family-post-comment.entity';
import { FamilyPostLikeEntity } from '../entities/family-post-like.entity';
import { FamilyPostMediaEntity } from '../entities/family-post-media.entity';
import { FamilyPostEntity } from '../entities/family-post.entity';
import { FamilyMediaTarget } from '../entities/family-media.types';
import { FamilyEventService } from './family-event.service';
import { FamilyService } from './family.service';

describe('FamilyService', () => {
  let service: FamilyService;
  let postRepository: jest.Mocked<Repository<FamilyPostEntity>>;
  let postMediaRepository: jest.Mocked<Repository<FamilyPostMediaEntity>>;
  let postLikeRepository: jest.Mocked<Repository<FamilyPostLikeEntity>>;
  let postCommentRepository: jest.Mocked<Repository<FamilyPostCommentEntity>>;
  let chatMessageRepository: jest.Mocked<Repository<FamilyChatMessageEntity>>;
  let chatMessageMediaRepository: jest.Mocked<Repository<FamilyChatMessageMediaEntity>>;
  let fileRepository: jest.Mocked<Repository<FileEntity>>;
  let userRepository: jest.Mocked<Repository<UserEntity>>;
  let notificationService: jest.Mocked<NotificationService>;
  let eventService: jest.Mocked<FamilyEventService>;
  let fileService: jest.Mocked<FileService>;
  let logger: jest.Mocked<LoggerService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FamilyService,
        { provide: getRepositoryToken(FamilyPostEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(FamilyPostMediaEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(FamilyPostLikeEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(FamilyPostCommentEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(FamilyChatMessageEntity), useValue: createMockRepository() },
        {
          provide: getRepositoryToken(FamilyChatMessageMediaEntity),
          useValue: createMockRepository(),
        },
        { provide: getRepositoryToken(FileEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(UserEntity), useValue: createMockRepository() },
        {
          provide: FileService,
          useValue: {
            createDirectUpload: jest.fn(),
            upload: jest.fn(),
            createTrustedAccessLink: jest.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            createNotification: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: FamilyEventService,
          useValue: {
            emitPostCreated: jest.fn(),
            emitPostCommentCreated: jest.fn(),
            emitPostLikeChanged: jest.fn(),
            emitChatMessageCreated: jest.fn(),
            emitNotificationCreated: jest.fn(),
          },
        },
        { provide: LoggerService, useValue: createMockLogger() },
      ],
    }).compile();

    service = module.get(FamilyService);
    postRepository = module.get(getRepositoryToken(FamilyPostEntity));
    postMediaRepository = module.get(getRepositoryToken(FamilyPostMediaEntity));
    postLikeRepository = module.get(getRepositoryToken(FamilyPostLikeEntity));
    postCommentRepository = module.get(getRepositoryToken(FamilyPostCommentEntity));
    chatMessageRepository = module.get(getRepositoryToken(FamilyChatMessageEntity));
    chatMessageMediaRepository = module.get(getRepositoryToken(FamilyChatMessageMediaEntity));
    fileRepository = module.get(getRepositoryToken(FileEntity));
    userRepository = module.get(getRepositoryToken(UserEntity));
    notificationService = module.get(NotificationService);
    eventService = module.get(FamilyEventService);
    fileService = module.get(FileService);
    logger = module.get(LoggerService);

    postRepository.create.mockImplementation((data) => data as FamilyPostEntity);
    postRepository.save.mockImplementation(async (data) =>
      Object.assign(new FamilyPostEntity(), data, { id: 11 }),
    );
    postMediaRepository.create.mockImplementation((data) => data as FamilyPostMediaEntity);
    postMediaRepository.save.mockImplementation(async (data) => data as FamilyPostMediaEntity[]);
    postCommentRepository.create.mockImplementation((data) => data as FamilyPostCommentEntity);
    postCommentRepository.save.mockImplementation(async (data) =>
      Object.assign(new FamilyPostCommentEntity(), data, { id: 31 }),
    );
    postLikeRepository.create.mockImplementation((data) => data as FamilyPostLikeEntity);
    postLikeRepository.save.mockImplementation(async (data) =>
      Object.assign(new FamilyPostLikeEntity(), data, { id: 41 }),
    );
    chatMessageRepository.create.mockImplementation((data) => data as FamilyChatMessageEntity);
    chatMessageRepository.save.mockImplementation(async (data) =>
      Object.assign(new FamilyChatMessageEntity(), data, { id: 51 }),
    );
    chatMessageMediaRepository.create.mockImplementation(
      (data) => data as FamilyChatMessageMediaEntity,
    );
    chatMessageMediaRepository.save.mockImplementation(
      async (data) => data as FamilyChatMessageMediaEntity[],
    );
  });

  it('creates a post with image and video media and notifies every active family member except the author', async () => {
    const files = [
      Object.assign(new FileEntity(), {
        id: 7,
        uploaderId: 1,
        module: 'family-circle',
        storage: FileStorageType.OSS,
        mimeType: 'image/jpeg',
        category: 'image',
      }),
      Object.assign(new FileEntity(), {
        id: 8,
        uploaderId: 1,
        module: 'family-circle',
        storage: FileStorageType.OSS,
        mimeType: 'video/mp4',
        category: 'video',
      }),
    ];
    fileRepository.find.mockResolvedValue(files);
    userRepository.find.mockResolvedValue([
      Object.assign(new UserEntity(), { id: 1 }),
      Object.assign(new UserEntity(), { id: 2 }),
      Object.assign(new UserEntity(), { id: 3 }),
    ]);

    const post = await service.createPost(
      { content: '宝宝今天会走路了', mediaFileIds: [7, 8] },
      { id: 1, username: 'dad', email: 'dad@example.com', roles: [], sessionId: 's1' },
    );

    expect(post.id).toBe(11);
    expect(postMediaRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({ postId: 11, fileId: 7, mediaType: 'image', sort: 0 }),
      expect.objectContaining({ postId: 11, fileId: 8, mediaType: 'video', sort: 1 }),
    ]);
    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: [2, 3],
        title: '新的家庭动态',
        sendExternal: false,
        metadata: expect.objectContaining({
          mobileLink: '/m/family',
          postId: 11,
        }),
      }),
      1,
    );
    expect(eventService.emitPostCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: 11,
        authorId: 1,
        author: expect.objectContaining({ id: 1, username: 'dad' }),
        createdAt: expect.any(Date),
      }),
    );
  });

  it('rejects creating empty posts without media', async () => {
    await expect(
      service.createPost(
        { content: '   ', mediaFileIds: [] },
        { id: 1, username: 'dad', email: 'dad@example.com', roles: [], sessionId: 's1' },
      ),
    ).rejects.toThrow(BusinessException);
  });

  it('rejects media that was uploaded by another user', async () => {
    fileRepository.find.mockResolvedValue([
      Object.assign(new FileEntity(), {
        id: 7,
        uploaderId: 9,
        module: 'family-circle',
        storage: FileStorageType.OSS,
        mimeType: 'image/jpeg',
        category: 'image',
      }),
    ]);

    await expect(
      service.createPost(
        { content: '照片', mediaFileIds: [7] },
        { id: 1, username: 'dad', email: 'dad@example.com', roles: [], sessionId: 's1' },
      ),
    ).rejects.toThrow(BusinessException);
  });

  it('links comment notifications to the family circle feed', async () => {
    postRepository.findOne.mockResolvedValue(Object.assign(new FamilyPostEntity(), { id: 11 }));
    userRepository.find.mockResolvedValue([
      Object.assign(new UserEntity(), { id: 1 }),
      Object.assign(new UserEntity(), { id: 2 }),
    ]);

    await service.createComment(
      11,
      { content: '真好看' },
      { id: 1, username: 'dad', email: 'dad@example.com', roles: [], sessionId: 's1' },
    );

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '新的家庭评论',
        metadata: expect.objectContaining({
          mobileLink: '/m/family',
          postId: 11,
          commentId: 31,
        }),
      }),
      1,
    );
  });

  it('logs family comment creation without storing comment content', async () => {
    postRepository.findOne.mockResolvedValue(Object.assign(new FamilyPostEntity(), { id: 11 }));
    userRepository.find.mockResolvedValue([
      Object.assign(new UserEntity(), { id: 1 }),
      Object.assign(new UserEntity(), { id: 2 }),
    ]);

    await service.createComment(
      11,
      { content: '真好看' },
      { id: 1, username: 'dad', email: 'dad@example.com', roles: [], sessionId: 's1' },
    );

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('[FamilyComment] create requested'),
      'FamilyService',
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('[FamilyComment] create saved'),
      'FamilyService',
    );
    expect(logger.log.mock.calls.flat().join(' ')).not.toContain('真好看');
  });

  it('logs family comment creation failures with safe context', async () => {
    const databaseError = new Error('Unknown column parentCommentId');
    postRepository.findOne.mockResolvedValue(Object.assign(new FamilyPostEntity(), { id: 11 }));
    postCommentRepository.save.mockRejectedValue(databaseError);

    await expect(
      service.createComment(
        11,
        { content: '真好看' },
        { id: 1, username: 'dad', email: 'dad@example.com', roles: [], sessionId: 's1' },
      ),
    ).rejects.toThrow(databaseError);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('[FamilyComment] create failed'),
      databaseError.stack,
      'FamilyService',
    );
    expect(logger.error.mock.calls.flat().join(' ')).toContain('postId=11');
    expect(logger.error.mock.calls.flat().join(' ')).not.toContain('真好看');
  });

  it('creates replies with parent comment and reply target', async () => {
    postRepository.findOne.mockResolvedValue(Object.assign(new FamilyPostEntity(), { id: 11 }));
    postCommentRepository.findOne.mockResolvedValue(
      Object.assign(new FamilyPostCommentEntity(), {
        id: 30,
        postId: 11,
        authorId: 2,
        author: Object.assign(new UserEntity(), { id: 2, username: 'mom' }),
      }),
    );
    userRepository.find.mockResolvedValue([
      Object.assign(new UserEntity(), { id: 1 }),
      Object.assign(new UserEntity(), { id: 2 }),
    ]);

    await service.createComment(
      11,
      { content: '我也觉得', parentCommentId: 30 },
      { id: 1, username: 'dad', email: 'dad@example.com', roles: [], sessionId: 's1' },
    );

    expect(postCommentRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: 11,
        authorId: 1,
        parentCommentId: 30,
        replyToUserId: 2,
        content: '我也觉得',
      }),
    );
    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          kind: 'comment-reply',
          parentCommentId: 30,
        }),
      }),
      1,
    );
  });

  it('uses WebP display links for family images and original links for videos', async () => {
    fileService.createTrustedAccessLink
      .mockResolvedValueOnce({
        url: '/api/v1/files/7/access?token=webp',
        token: 'webp',
        expiresAt: '2026-05-04T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        url: '/api/v1/files/8/access?token=video',
        token: 'video',
        expiresAt: '2026-05-04T00:00:00.000Z',
      });

    const result = await service.toMediaResponse([
      Object.assign(new FamilyPostMediaEntity(), {
        id: 1,
        fileId: 7,
        mediaType: 'image',
        sort: 0,
        file: Object.assign(new FileEntity(), {
          id: 7,
          mimeType: 'image/jpeg',
          category: 'image',
        }),
      }),
      Object.assign(new FamilyPostMediaEntity(), {
        id: 2,
        fileId: 8,
        mediaType: 'video',
        sort: 1,
        file: Object.assign(new FileEntity(), {
          id: 8,
          mimeType: 'video/mp4',
          category: 'video',
        }),
      }),
    ]);

    expect(fileService.createTrustedAccessLink).toHaveBeenNthCalledWith(
      1,
      7,
      expect.objectContaining({
        disposition: 'inline',
        process: 'image/format,webp/quality,Q_100',
        cacheMaxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    );
    expect(fileService.createTrustedAccessLink).toHaveBeenNthCalledWith(
      2,
      8,
      expect.objectContaining({ disposition: 'inline', cacheMaxAgeSeconds: 30 * 24 * 60 * 60 }),
    );
    expect(result).toEqual([
      expect.objectContaining({ fileId: 7, mediaType: 'image', displayUrl: expect.any(String) }),
      expect.objectContaining({ fileId: 8, mediaType: 'video', displayUrl: expect.any(String) }),
    ]);
  });

  it('returns liked user summaries for family posts', async () => {
    const likedUser = Object.assign(new UserEntity(), {
      id: 4,
      username: 'mom',
      nickname: '妈妈',
      avatar: 'https://example.com/mom.png',
    });
    const post = Object.assign(new FamilyPostEntity(), {
      id: 11,
      content: '照片',
      authorId: 1,
      author: Object.assign(new UserEntity(), { id: 1, username: 'dad', nickname: '爸爸' }),
      media: [],
      comments: [],
      likes: [
        Object.assign(new FamilyPostLikeEntity(), {
          postId: 11,
          userId: 4,
          user: likedUser,
        }),
      ],
      createdAt: new Date('2026-05-04T07:00:00.000Z'),
      updatedAt: new Date('2026-05-04T07:00:00.000Z'),
    });
    postRepository.findAndCount.mockResolvedValue([[post], 1]);

    const result = await service.findPosts(
      { page: 1, limit: 20 },
      { id: 4, username: 'mom', email: 'mom@example.com', roles: [], sessionId: 's1' },
    );

    expect(postRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        relations: expect.arrayContaining(['likes', 'likes.user']),
      }),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        likeCount: 1,
        likedByMe: true,
        likedUsers: [
          expect.objectContaining({
            id: 4,
            nickname: '妈妈',
            avatar: 'https://example.com/mom.png',
          }),
        ],
      }),
    );
  });

  it('returns only newer family posts when afterId is provided', async () => {
    postRepository.findAndCount.mockResolvedValue([[], 0]);

    await service.findPosts(
      { page: 1, limit: 20, afterId: 10 },
      { id: 4, username: 'mom', email: 'mom@example.com', roles: [], sessionId: 's1' },
    );

    expect(postRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: expect.any(Object),
        },
      }),
    );
  });

  it('returns one family post for detail pages', async () => {
    const post = Object.assign(new FamilyPostEntity(), {
      id: 11,
      content: '今天去看了花花',
      authorId: 1,
      author: Object.assign(new UserEntity(), { id: 1, username: 'dad', nickname: '爸爸' }),
      media: [],
      comments: [
        Object.assign(new FamilyPostCommentEntity(), {
          id: 31,
          postId: 11,
          content: '真好看',
          authorId: 2,
          author: Object.assign(new UserEntity(), { id: 2, username: 'mom', nickname: '妈妈' }),
          createdAt: new Date('2026-05-04T08:00:00.000Z'),
          updatedAt: new Date('2026-05-04T08:00:00.000Z'),
        }),
        Object.assign(new FamilyPostCommentEntity(), {
          id: 32,
          postId: 11,
          parentCommentId: 31,
          replyToUserId: 2,
          content: '确实很漂亮',
          authorId: 1,
          author: Object.assign(new UserEntity(), { id: 1, username: 'dad', nickname: '爸爸' }),
          replyToUser: Object.assign(new UserEntity(), {
            id: 2,
            username: 'mom',
            nickname: '妈妈',
          }),
          createdAt: new Date('2026-05-04T08:10:00.000Z'),
          updatedAt: new Date('2026-05-04T08:10:00.000Z'),
        }),
      ],
      likes: [
        Object.assign(new FamilyPostLikeEntity(), {
          postId: 11,
          userId: 2,
          user: Object.assign(new UserEntity(), { id: 2, username: 'mom', nickname: '妈妈' }),
        }),
      ],
      createdAt: new Date('2026-05-04T07:00:00.000Z'),
      updatedAt: new Date('2026-05-04T07:00:00.000Z'),
    });
    postRepository.findOne.mockResolvedValue(post);

    const result = await service.findPost(11, {
      id: 2,
      username: 'mom',
      email: 'mom@example.com',
      roles: [],
      sessionId: 's1',
    });

    expect(postRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        relations: expect.arrayContaining([
          'media.file',
          'comments.author',
          'comments.replyToUser',
          'likes.user',
        ]),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 11,
        content: '今天去看了花花',
        likedByMe: true,
        comments: [
          expect.objectContaining({ content: '真好看', parentCommentId: null }),
          expect.objectContaining({
            content: '确实很漂亮',
            parentCommentId: 31,
            replyToUser: expect.objectContaining({ nickname: '妈妈' }),
          }),
        ],
        likedUsers: [expect.objectContaining({ nickname: '妈妈' })],
      }),
    );
  });

  it('updates likes without creating notifications', async () => {
    postRepository.findOne.mockResolvedValue(Object.assign(new FamilyPostEntity(), { id: 11 }));
    postLikeRepository.findOne.mockResolvedValue(null);

    await service.likePost(11, {
      id: 1,
      username: 'dad',
      email: 'dad@example.com',
      roles: [],
      sessionId: 's1',
    });

    expect(postLikeRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ postId: 11, userId: 1 }),
    );
    expect(notificationService.createNotification).not.toHaveBeenCalled();
    expect(eventService.emitPostLikeChanged).toHaveBeenCalledWith({
      postId: 11,
      userId: 1,
      liked: true,
    });
  });

  it('rejects unliking a missing family post', async () => {
    postRepository.findOne.mockResolvedValue(null);

    await expect(
      service.unlikePost(999, {
        id: 1,
        username: 'dad',
        email: 'dad@example.com',
        roles: [],
        sessionId: 's1',
      }),
    ).rejects.toThrow(BusinessException);

    expect(postLikeRepository.delete).not.toHaveBeenCalled();
    expect(eventService.emitPostLikeChanged).not.toHaveBeenCalled();
  });

  it('keeps family direct uploads on OSS with a 500MB media limit', async () => {
    fileService.createDirectUpload.mockResolvedValue({
      method: 'PUT',
      uploadUrl: 'https://oss.example.com/upload',
      uploadToken: 'token',
      expiresAt: '2026-05-04T00:00:00.000Z',
      headers: {},
    });

    await service.createMediaDirectUpload(
      {
        target: FamilyMediaTarget.CHAT,
        originalName: 'family-video.mp4',
        mimeType: 'video/mp4',
        size: 500 * 1024 * 1024,
      },
      { id: 1, username: 'dad', email: 'dad@example.com', roles: [], sessionId: 's1' },
    );

    expect(fileService.createDirectUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'family-chat',
        isPublic: false,
        originalName: 'family-video.mp4',
      }),
      1,
      {
        maxSize: 500 * 1024 * 1024,
        allowedTypes: expect.arrayContaining(['.jpg', '.webp', '.mp4', '.mov', '.webm']),
      },
    );
  });

  it('uploads family media to local storage for temporary non-OSS testing', async () => {
    const uploadedFile = Object.assign(new FileEntity(), {
      id: 70,
      uploaderId: 1,
      module: 'family-circle',
      storage: FileStorageType.LOCAL,
      mimeType: 'image/jpeg',
      category: 'image',
    });
    fileService.upload.mockResolvedValue(uploadedFile);

    const result = await service.uploadLocalMedia(
      {
        originalname: 'meal.jpg',
        mimetype: 'image/jpeg',
      } as Express.Multer.File,
      { target: FamilyMediaTarget.CIRCLE },
      { id: 1, username: 'dad', email: 'dad@example.com', roles: [], sessionId: 's1' },
    );

    expect(result).toBe(uploadedFile);
    expect(fileService.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        originalname: 'meal.jpg',
        mimetype: 'image/jpeg',
      }),
      expect.objectContaining({
        module: 'family-circle',
        tags: 'family,media',
        isPublic: false,
        storage: FileStorageType.LOCAL,
        maxSize: 500 * 1024 * 1024,
        allowedTypes: expect.arrayContaining(['.jpg', '.webp', '.mp4', '.mov', '.webm']),
      }),
      1,
    );
  });

  it('accepts locally uploaded media when creating family posts', async () => {
    fileRepository.find.mockResolvedValue([
      Object.assign(new FileEntity(), {
        id: 17,
        uploaderId: 1,
        module: 'family-circle',
        storage: FileStorageType.LOCAL,
        mimeType: 'image/jpeg',
        category: 'image',
      }),
    ]);
    userRepository.find.mockResolvedValue([Object.assign(new UserEntity(), { id: 1 })]);

    await service.createPost(
      { content: '本地图片', mediaFileIds: [17] },
      { id: 1, username: 'dad', email: 'dad@example.com', roles: [], sessionId: 's1' },
    );

    expect(postMediaRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({ postId: 11, fileId: 17, mediaType: 'image', sort: 0 }),
    ]);
  });

  it('creates chat messages with text and video media', async () => {
    fileRepository.find.mockResolvedValue([
      Object.assign(new FileEntity(), {
        id: 18,
        uploaderId: 1,
        module: 'family-chat',
        storage: FileStorageType.OSS,
        mimeType: 'video/mp4',
        category: 'video',
      }),
    ]);
    userRepository.find.mockResolvedValue([
      Object.assign(new UserEntity(), { id: 1 }),
      Object.assign(new UserEntity(), { id: 2 }),
    ]);

    const message = await service.createChatMessage(
      { content: '看这个视频', mediaFileIds: [18] },
      { id: 1, username: 'dad', email: 'dad@example.com', roles: [], sessionId: 's1' },
    );

    expect(message.id).toBe(51);
    expect(chatMessageMediaRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({ messageId: 51, fileId: 18, mediaType: 'video', sort: 0 }),
    ]);
    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: [2],
        title: '新的家庭群聊消息',
        sendExternal: false,
        metadata: expect.objectContaining({
          mobileLink: '/m/family/chat',
          messageId: 51,
        }),
      }),
      1,
    );
    expect(eventService.emitChatMessageCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 51,
        senderId: 1,
        sender: expect.objectContaining({ id: 1, username: 'dad' }),
        createdAt: expect.any(Date),
      }),
    );
  });
});
