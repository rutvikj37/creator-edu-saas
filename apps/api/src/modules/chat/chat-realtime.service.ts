import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

export type ChatMessagePayload = {
  conversationId: string;
  message: { id: string; side: 'customer' | 'agent'; body: string; createdAt: Date | string; senderName: string };
  status: string;
};

/** Thin bridge so ChatService can push into Socket.IO rooms without importing the gateway. */
@Injectable()
export class ChatRealtimeService {
  private server: Server | null = null;

  attach(server: Server) {
    this.server = server;
  }

  room(conversationId: string) {
    return `chat:${conversationId}`;
  }

  emitMessage(payload: ChatMessagePayload) {
    this.server?.to(this.room(payload.conversationId)).emit('chat:message', payload);
  }

  emitStatus(conversationId: string, status: string) {
    this.server?.to(this.room(conversationId)).emit('chat:status', { conversationId, status });
  }
}
