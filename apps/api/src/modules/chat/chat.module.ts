import { Module } from '@nestjs/common';
import { CreatorChatController, CreatorSupportChatController, LearnChatController, PlatformSupportChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({ controllers: [LearnChatController, CreatorChatController, CreatorSupportChatController, PlatformSupportChatController], providers: [ChatService] })
export class ChatModule {}
