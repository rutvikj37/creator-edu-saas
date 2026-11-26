import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { SkipThrottle } from '@nestjs/throttler';
import type { Server, Socket } from 'socket.io';
import { Public } from '../../common/decorators/public.decorator.js';
import { platformStaffAllowedOnHost, realmKeyOf, type AuthContext, type HostRealm } from '../../core/tenancy/request-context.js';
import { HostResolverService } from '../../core/tenancy/host-resolver.service.js';
import { SessionService } from '../auth/services/session.service.js';
import { TokenService } from '../auth/services/token.service.js';
import { ChatRealtimeService } from './chat-realtime.service.js';
import { ChatService } from './chat.service.js';

type AuthedSocket = Socket & { data: { auth?: AuthContext; hostRealm?: HostRealm } };

/**
 * Realtime chat delivery. Auth mirrors REST (Bearer access JWT + host-bound realm + session
 * revocation). Clients join one conversation room after `subscribe`; new messages are pushed
 * from ChatService via ChatRealtimeService (Redis adapter fans out across instances).
 */
@SkipThrottle()
@Public()
@WebSocketGateway({ namespace: '/chat', transports: ['websocket', 'polling'] })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly hosts: HostResolverService,
    private readonly chat: ChatService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
  }

  async handleConnection(client: AuthedSocket) {
    try {
      const auth = await this.authenticate(client);
      client.data.auth = auth;
    } catch (e) {
      this.log.debug(`chat socket rejected: ${e instanceof Error ? e.message : 'auth failed'}`);
      client.emit('chat:error', { code: 'UNAUTHENTICATED', message: 'Sign in to use live chat.' });
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: AuthedSocket) {
    // Rooms are left automatically; nothing else to clean up.
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: { conversationId?: string }) {
    const auth = client.data.auth;
    if (!auth) return { ok: false, error: 'UNAUTHENTICATED' };
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.slice(0, 40) : '';
    if (!conversationId) return { ok: false, error: 'INVALID' };
    try {
      await this.chat.assertCanSubscribe(auth, conversationId);
      await client.join(this.realtime.room(conversationId));
      return { ok: true, conversationId };
    } catch {
      return { ok: false, error: 'FORBIDDEN' };
    }
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: { conversationId?: string }) {
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.slice(0, 40) : '';
    if (conversationId) await client.leave(this.realtime.room(conversationId));
    return { ok: true };
  }

  private async authenticate(client: AuthedSocket): Promise<AuthContext> {
    const hostname = this.hostnameOf(client);
    const hostRealm = (await this.hosts.resolve(hostname)) ?? undefined;
    if (!hostRealm) throw new Error('unknown host');
    client.data.hostRealm = hostRealm;

    const token = this.tokenOf(client);
    if (!token) throw new Error('missing token');
    const auth = await this.tokens.verifyAccess(token);
    if (!auth) throw new Error('invalid token');
    if (auth.realmKey !== realmKeyOf(hostRealm) && !platformStaffAllowedOnHost(auth, hostRealm)) {
      throw new Error('host mismatch');
    }
    if (await this.sessions.isRevoked(auth.sessionId)) throw new Error('revoked session');
    auth.mfaSetupRequired = false;
    return auth;
  }

  private tokenOf(client: Socket): string | undefined {
    const fromAuth = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth;
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }

  private hostnameOf(client: Socket): string {
    const forwarded = client.handshake.headers['x-forwarded-host'];
    const fwd = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : Array.isArray(forwarded) ? String(forwarded[0] ?? '') : '';
    const hostHdr = typeof client.handshake.headers.host === 'string' ? client.handshake.headers.host : '';
    const candidate = (fwd || hostHdr).split(':')[0].trim().toLowerCase();
    if (candidate) return candidate;
    try {
      return new URL(String(client.handshake.headers.origin ?? '')).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
}
