import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CreatorChatController, CreatorSupportChatController, LearnChatController, PlatformSupportChatController } from './chat.controller.js';
import { ChatGateway } from './chat.gateway.js';
import { ChatRealtimeService } from './chat-realtime.service.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AuthModule],
  controllers: [LearnChatController, CreatorChatController, CreatorSupportChatController, PlatformSupportChatController],
  providers: [ChatService, ChatRealtimeService, ChatGateway],
})
export class ChatModule {}
