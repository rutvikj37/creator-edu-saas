import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

/** Socket.IO path under `/api` so Vite/nginx same-origin proxies cover WS upgrades. */
export const CHAT_SOCKET_PATH = '/api/socket.io';

/**
 * Attaches Socket.IO to the Nest HTTP server with a Redis adapter so rooms and emits
 * fan out across API instances (same Redis already used for chat long-poll wakeups).
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pub: Redis | null = null;
  private sub: Redis | null = null;

  constructor(
    app: INestApplication,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  async connectToRedis() {
    this.pub = new Redis(this.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
    this.sub = this.pub.duplicate();
    this.adapterConstructor = createAdapter(this.pub, this.sub);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      path: CHAT_SOCKET_PATH,
      // Browser connects same-origin via the SPA host proxy; credentials carry cookies if needed.
      cors: { origin: true, credentials: true },
      transports: ['websocket', 'polling'],
      ...(options ?? {}),
    } as ServerOptions);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  async closeRedis() {
    await Promise.all([this.pub?.quit().catch(() => undefined), this.sub?.quit().catch(() => undefined)]);
    this.pub = null;
    this.sub = null;
  }
}
