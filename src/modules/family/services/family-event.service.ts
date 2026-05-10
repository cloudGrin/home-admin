import { Injectable } from '@nestjs/common';
import { FamilyGateway } from '../gateways/family.gateway';

@Injectable()
export class FamilyEventService {
  constructor(private readonly familyGateway: FamilyGateway) {}

  emitPostCreated(payload: unknown): void {
    this.familyGateway.emitToFamily('family:post-created', payload);
  }

  emitPostDeleted(payload: unknown): void {
    this.familyGateway.emitToFamily('family:post-deleted', payload);
  }

  emitPostCommentCreated(payload: unknown): void {
    this.familyGateway.emitToFamily('family:post-comment-created', payload);
  }

  emitPostCommentDeleted(payload: unknown): void {
    this.familyGateway.emitToFamily('family:post-comment-deleted', payload);
  }

  emitPostLikeChanged(payload: unknown): void {
    this.familyGateway.emitToFamily('family:post-like-changed', payload);
  }

  emitChatMessageCreated(payload: unknown): void {
    this.familyGateway.emitToFamily('family:chat-message-created', payload);
  }

  emitChatMessageDeleted(payload: unknown): void {
    this.familyGateway.emitToFamily('family:chat-message-deleted', payload);
  }

  emitNotificationCreated(payload: unknown): void {
    this.familyGateway.emitToFamily('family:notification-created', payload);
  }
}
