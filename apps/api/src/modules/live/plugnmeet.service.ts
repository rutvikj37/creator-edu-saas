import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { PlugNmeet, StatusCode } from 'plugnmeet-sdk-js';
import { safeEqual } from '../../core/crypto/crypto.service.js';
import { AppConfig } from '../../config/app-config.service.js';

/** Thrown when plugNmeet rejects or cannot be reached. `retryable` = transient (network/5xx). */
export class PlugNmeetError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: number) {
    super(message);
  }
}

export interface PnmRoomOptions {
  roomId: string;
  title: string;
  webinar: boolean;
  waitingRoom: boolean;
  record: boolean;
  maxParticipants: number | null;
  webhookUrl: string;
  logoutUrl: string | null;
  welcomeMessage?: string;
}

export interface PnmUser {
  identity: string;
  name: string;
  admin: boolean;
  waitForApproval: boolean;
}

export interface PnmParticipant {
  identity: string;
  name: string;
  joinedAt: Date | null;
}

export interface PnmRecording {
  recordId: string;
  roomId: string;
  roomSid: string;
  /** As reported by plugNmeet (a float, not an exact byte count); informational only. */
  fileSize: number;
  createdAt: Date | null;
}

/** Codes where retrying the same call cannot help. */
const PERMANENT = new Set<number>([StatusCode.PERMISSION_DENIED, StatusCode.INVALID_API_KEY, StatusCode.INVALID_TOKEN_OR_SIGNATURE, StatusCode.INVALID_PARAMETERS, StatusCode.MISSING_REQUIRED_PARAMETER, StatusCode.NOT_FOUND, StatusCode.ROOM_NOT_FOUND]);

/** plugNmeet sends unix seconds (int64 → string in JSON). */
const fromUnix = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
};

/**
 * plugNmeet integration (platform-provided, self-hosted server). All server calls go through the
 * official `plugnmeet-sdk-js`, which signs each request body with HMAC-SHA256 of the API secret
 * (`API-KEY` + `HASH-SIGNATURE` headers). Credentials never reach the browser: students receive a
 * short-lived join token for the plugNmeet client only.
 */
@Injectable()
export class PlugNmeetService {
  private client: PlugNmeet | null = null;

  constructor(private readonly config: AppConfig) {}

  private get creds() {
    const url = this.config.get('PLUGNMEET_URL');
    const key = this.config.get('PLUGNMEET_API_KEY');
    const secret = this.config.get('PLUGNMEET_API_SECRET');
    return url && key && secret ? { url: url.replace(/\/+$/, ''), key, secret } : null;
  }

  isConfigured() {
    return Boolean(this.creds);
  }

  private require() {
    const c = this.creds;
    if (!c) throw new PlugNmeetError('plugNmeet is not configured', false);
    this.client ??= new PlugNmeet(c.url, c.key, c.secret);
    return { ...c, pnm: this.client };
  }

  /** The SDK returns `{status:false,msg}` instead of throwing; network failures arrive as msg text. */
  private check<T extends { status: boolean; msg: string; statusCode: number }>(res: T, what: string): T {
    if (res.status) return res;
    const code = Number(res.statusCode) || 0;
    const retryable = !code || code === StatusCode.INTERNAL_SERVER_ERROR || code === StatusCode.UNKNOWN_STATUS;
    throw new PlugNmeetError(`${what}: ${String(res.msg || 'no response').slice(0, 300)}`, retryable && !PERMANENT.has(code), code);
  }

  /** Secret path segment for a session's webhook URL (only plugNmeet learns it, server to server). */
  webhookToken(sessionId: string) {
    return createHmac('sha256', this.require().secret).update(`plugnmeet-webhook:${sessionId}`).digest('hex').slice(0, 40);
  }

  verifyWebhookToken(sessionId: string, token: string) {
    if (!this.creds) return false;
    return safeEqual(token, this.webhookToken(sessionId));
  }

  async isRoomActive(roomId: string) {
    const { pnm } = this.require();
    const res = await pnm.isRoomActive({ roomId } as never);
    if (!res.status && Number(res.statusCode) === StatusCode.ROOM_NOT_ACTIVE) return false;
    if (!res.status && Number(res.statusCode) === StatusCode.ROOM_NOT_FOUND) return false;
    return this.check(res, 'isRoomActive').isActive;
  }

  /** Creates the room (plugNmeet keeps it while people are inside, then closes it after `emptyTimeout`). */
  async createRoom(o: PnmRoomOptions) {
    const { pnm } = this.require();
    const attendeeLocks = o.webinar ? { lockMicrophone: true, lockWebcam: true, lockScreenSharing: true, lockWhiteboard: true, lockSharedNotepad: true, lockPrivateChat: true } : { lockPrivateChat: true };
    const res = await pnm.createRoom({
      roomId: o.roomId,
      emptyTimeout: 10 * 60,
      ...(o.maxParticipants ? { maxParticipants: o.maxParticipants } : {}),
      metadata: {
        roomTitle: o.title.slice(0, 200),
        ...(o.welcomeMessage ? { welcomeMessage: o.welcomeMessage } : {}),
        webhookUrl: o.webhookUrl,
        ...(o.logoutUrl ? { logoutUrl: o.logoutUrl } : {}),
        extraData: {},
        defaultLockSettings: attendeeLocks,
        roomFeatures: {
          allowWebcams: true,
          muteOnStart: o.webinar,
          allowScreenShare: true,
          allowViewOtherWebcams: !o.webinar,
          allowViewOtherUsersList: !o.webinar,
          adminOnlyWebcams: o.webinar,
          enableAnalytics: true,
          allowRaiseHand: true,
          allowReactions: true,
          chatFeatures: { isAllow: true, isAllowFileUpload: !o.webinar, allowedFileTypes: [] },
          sharedNotePadFeatures: { isAllow: true, isActive: false, visible: false, notePadId: '' },
          whiteboardFeatures: { isAllow: true, visible: false, whiteboardFileId: '', fileName: '', filePath: '', totalPages: 0 },
          pollsFeatures: { isAllow: true, isActive: false },
          breakoutRoomFeatures: { isAllow: !o.webinar, isActive: false, allowedNumberRooms: 6, allowReturnToMainRoom: true, allowSelfSelect: false, preassignedRooms: [] },
          waitingRoomFeatures: { isActive: o.waitingRoom, waitingRoomMsg: o.waitingRoom ? 'The host will let you in shortly.' : '' },
          recordingFeatures: { isAllow: o.record, isAllowCloud: o.record, enableAutoCloudRecording: o.record, isAllowLocal: false, onlyRecordAdminWebcams: false },
        },
      },
    } as never);
    this.check(res, 'createRoom');
  }

  /** Join token for the plugNmeet client. Identity is ours (usr_/reg_/host_…) so webhooks map back. */
  async joinToken(roomId: string, u: PnmUser) {
    const { pnm } = this.require();
    const res = this.check(await pnm.getJoinToken({
      roomId,
      userInfo: {
        name: u.name.slice(0, 120), userId: u.identity, isAdmin: u.admin, isHidden: false,
        userMetadata: { isAdmin: u.admin, isPresenter: u.admin, waitForApproval: u.waitForApproval, exUserId: u.identity, extraData: {} },
      },
    } as never), 'getJoinToken');
    if (!res.token) throw new PlugNmeetError('getJoinToken: no token returned', true);
    return res.token;
  }

  /**
   * Where the browser opens the classroom. The plugNmeet client is served by the plugNmeet server
   * and reads the token from `access_token`. (Verify against your deployment before going live.)
   */
  clientUrl(token: string) {
    return `${this.require().url}/?access_token=${encodeURIComponent(token)}`;
  }

  /** People currently in the room; null when the room is not running. */
  async participants(roomId: string): Promise<PnmParticipant[] | null> {
    const { pnm } = this.require();
    const res = await pnm.getActiveRoomInfo({ roomId } as never);
    const code = Number(res.statusCode);
    if (!res.status && (code === StatusCode.ROOM_NOT_ACTIVE || code === StatusCode.ROOM_NOT_FOUND || code === StatusCode.NOT_FOUND)) return null;
    const room = this.check(res, 'getActiveRoomInfo').room;
    if (!room?.roomInfo) return null;
    return (room.participantsInfo ?? [])
      .filter((p) => p.identity)
      .map((p) => ({ identity: p.identity, name: p.name, joinedAt: fromUnix(p.joinedAt) }));
  }

  async endRoom(roomId: string) {
    const { pnm } = this.require();
    const res = await pnm.endRoom({ roomId } as never);
    const code = Number(res.statusCode);
    if (!res.status && (code === StatusCode.ROOM_NOT_ACTIVE || code === StatusCode.ROOM_NOT_FOUND || code === StatusCode.NOT_FOUND)) return;
    this.check(res, 'endRoom');
  }

  async recordings(roomId: string): Promise<PnmRecording[]> {
    const { pnm } = this.require();
    const res = this.check(await pnm.fetchRecordings({ roomIds: [roomId], from: 0, limit: 50, orderBy: 'ASC' } as never), 'fetchRecordings');
    return (res.result?.recordingsList ?? []).map((r) => ({ recordId: r.recordId, roomId: r.roomId, roomSid: r.roomSid, fileSize: Number(r.fileSize) || 0, createdAt: fromUnix(r.creationTime) }));
  }

  /**
   * Streams a recording. plugNmeet issues a short-lived download token; the file is served at
   * `/download/recording/<token>` on the plugNmeet server.
   */
  async downloadRecording(recordId: string): Promise<{ stream: Readable; size: number | null }> {
    const { pnm, url } = this.require();
    const t = this.check(await pnm.getRecordingDownloadToken({ recordId } as never), 'getRecordingDownloadToken');
    if (!t.token) throw new PlugNmeetError('getRecordingDownloadToken: no token returned', true);
    const res = await fetch(`${url}/download/recording/${encodeURIComponent(t.token)}`, { signal: AbortSignal.timeout(30 * 60_000) }).catch((e: Error) => {
      throw new PlugNmeetError(`download: ${e.message}`, true);
    });
    if (!res.ok || !res.body) throw new PlugNmeetError(`download: HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    const len = Number(res.headers.get('content-length'));
    return { stream: Readable.fromWeb(res.body as never), size: Number.isFinite(len) && len > 0 ? len : null };
  }

  async deleteRecording(recordId: string) {
    const { pnm } = this.require();
    this.check(await pnm.deleteRecordings({ recordId } as never), 'deleteRecordings');
  }
}
