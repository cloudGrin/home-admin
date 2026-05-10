import { FamilyMediaType } from '../entities/family-media.types';

export interface FamilyUserSummaryDto {
  id: number;
  username: string;
  nickname?: string | null;
  realName?: string | null;
  avatar?: string | null;
}

export interface FamilyMediaResponseDto {
  id: number;
  fileId: number;
  mediaType: FamilyMediaType;
  sort: number;
  mimeType?: string;
  originalName?: string;
  size?: number;
  displayUrl: string;
  posterUrl?: string;
  expiresAt: string;
}

export interface FamilyPostCommentResponseDto {
  id: number;
  postId: number;
  parentCommentId?: number | null;
  replyToUserId?: number | null;
  content: string;
  authorId: number;
  author?: FamilyUserSummaryDto;
  replyToUser?: FamilyUserSummaryDto | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FamilyPostResponseDto {
  id: number;
  content?: string | null;
  authorId: number;
  author?: FamilyUserSummaryDto;
  media: FamilyMediaResponseDto[];
  comments: FamilyPostCommentResponseDto[];
  likeCount: number;
  likedByMe: boolean;
  likedUsers: FamilyUserSummaryDto[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FamilyChatMessageResponseDto {
  id: number;
  content?: string | null;
  senderId: number;
  sender?: FamilyUserSummaryDto;
  media: FamilyMediaResponseDto[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FamilyReadStateResponseDto {
  unreadPosts: number;
  unreadChatMessages: number;
  latestPostId: number | null;
  latestChatMessageId: number | null;
  lastReadPostId: number | null;
  lastReadChatMessageId: number | null;
}

export interface FamilyPostCreatedEventDto {
  postId: number;
  authorId: number;
  author?: FamilyUserSummaryDto;
  createdAt: Date;
}

export interface FamilyChatMessageCreatedEventDto {
  messageId: number;
  senderId: number;
  sender?: FamilyUserSummaryDto;
  createdAt: Date;
}
