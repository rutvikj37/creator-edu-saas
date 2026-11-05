import { Injectable } from '@nestjs/common';
import { AccessToken, EgressClient, EncodedFileOutput, RoomServiceClient, S3Upload, WebhookReceiver } from 'livekit-server-sdk';
import { AppConfig } from '../../config/app-config.service.js';

export interface LiveGrant {
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  roomAdmin?: boolean;
}

export interface NormalizedLiveEvent {
  id: string;
  event: string;
  roomName: string | null;
  identity: string | null;
  at: Date;
  egress?: { id: string; status: string; fileLocation: string | null; durationSeconds: number | null; error: string | null };
}

/**
 * LiveKit integration (platform-provided account). Access tokens and webhook signatures are
 * computed locally with the official SDK; room/egress calls go to the LiveKit server API.
 * Everything that talks to the network goes through this class.
 */
@Injectable()
export class LiveKitService {
  constructor(private readonly config: AppConfig) {}

  private get creds() {
    const url = this.config.get('LIVEKIT_URL');
    const key = this.config.get('LIVEKIT_API_KEY');
    const secret = this.config.get('LIVEKIT_API_SECRET');
    return url && key && secret ? { url, key, secret, httpUrl: url.replace(/^ws/, 'http') } : null;
  }

  isConfigured() {
    return Boolean(this.creds);
  }

  /** Client WebSocket URL. */
  wsUrl() {
    return this.creds?.url ?? null;
  }

  private require() {
    const c = this.creds;
    if (!c) throw new Error('LiveKit is not configured');
    return c;
  }

  async token(roomName: string, identity: string, name: string, grant: LiveGrant, metadata: Record<string, unknown>, ttlSeconds: number) {
    const c = this.require();
    const at = new AccessToken(c.key, c.secret, { identity, name, metadata: JSON.stringify(metadata), ttl: ttlSeconds });
    at.addGrant({ room: roomName, roomJoin: true, canPublish: grant.canPublish, canSubscribe: grant.canSubscribe, canPublishData: grant.canPublishData, roomAdmin: grant.roomAdmin ?? false });
    return at.toJwt();
  }

  async ensureRoom(roomName: string, maxParticipants: number | null) {
    const c = this.require();
    await new RoomServiceClient(c.httpUrl, c.key, c.secret).createRoom({ name: roomName, emptyTimeout: 10 * 60, maxParticipants: maxParticipants ?? 0 });
  }

  async deleteRoom(roomName: string) {
    const c = this.require();
    await new RoomServiceClient(c.httpUrl, c.key, c.secret).deleteRoom(roomName);
  }

  async setPermissions(roomName: string, identity: string, grant: LiveGrant, metadata: Record<string, unknown>) {
    const c = this.require();
    await new RoomServiceClient(c.httpUrl, c.key, c.secret).updateParticipant(roomName, identity, JSON.stringify(metadata), {
      canPublish: grant.canPublish, canSubscribe: grant.canSubscribe, canPublishData: grant.canPublishData,
    });
  }

  async removeParticipant(roomName: string, identity: string) {
    const c = this.require();
    await new RoomServiceClient(c.httpUrl, c.key, c.secret).removeParticipant(roomName, identity);
  }

  /** Records the room (grid layout, MP4) straight into the platform's S3 bucket. */
  async startRecording(roomName: string, s3: { bucket: string; region: string; accessKey: string; secret: string; endpoint?: string }, filepath: string) {
    const c = this.require();
    const output = new EncodedFileOutput({
      filepath,
      output: { case: 's3', value: new S3Upload({ bucket: s3.bucket, region: s3.region, accessKey: s3.accessKey, secret: s3.secret, endpoint: s3.endpoint ?? '', forcePathStyle: Boolean(s3.endpoint) }) },
    });
    const info = await new EgressClient(c.httpUrl, c.key, c.secret).startRoomCompositeEgress(roomName, output, { layout: 'grid' });
    return info.egressId;
  }

  async stopRecording(egressId: string) {
    const c = this.require();
    await new EgressClient(c.httpUrl, c.key, c.secret).stopEgress(egressId);
  }

  /** Verifies the Authorization JWT (HS256 with our API secret, carrying sha256 of the raw body). */
  async verifyWebhook(rawBody: string, authHeader: string | undefined): Promise<NormalizedLiveEvent> {
    const c = this.require();
    const e = await new WebhookReceiver(c.key, c.secret).receive(rawBody, authHeader);
    const file = e.egressInfo?.fileResults?.[0];
    return {
      id: e.id,
      event: e.event,
      roomName: e.room?.name ?? e.egressInfo?.roomName ?? null,
      identity: e.participant?.identity ?? null,
      at: e.createdAt ? new Date(Number(e.createdAt) * 1000) : new Date(),
      egress: e.egressInfo
        ? { id: e.egressInfo.egressId, status: String(e.egressInfo.status), fileLocation: file?.location ?? file?.filename ?? null, durationSeconds: file?.duration ? Math.round(Number(file.duration) / 1e9) : null, error: e.egressInfo.error || null }
        : undefined,
    };
  }
}
