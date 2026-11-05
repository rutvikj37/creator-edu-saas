import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

interface SimRoom {
  roomId: string;
  sid: string;
  active: boolean;
  metadata: any;
  emptyTimeout?: number;
  maxParticipants?: number;
  participants: Map<string, { identity: string; name: string; joinedAt: number }>;
}

/**
 * Local plugNmeet server for the e2e suite. It answers the `/auth/*` endpoints our code calls
 * through the official `plugnmeet-sdk-js`, with the message shapes of `plugnmeet-protocol-js`
 * (proto3 JSON, camelCase), and rejects requests whose `HASH-SIGNATURE` is not
 * HMAC-SHA256(body, secret) or whose `API-KEY` is wrong — exactly what the SDK sends.
 * Recording files are served at `/download/recording/<token>`. No external network.
 */
export class PlugNmeetSim {
  url = '';
  rooms = new Map<string, SimRoom>();
  recordings = new Map<string, { recordId: string; roomId: string; roomSid: string; bytes: Buffer; creationTime: number }>();
  downloadTokens = new Map<string, string>();
  joinTokens = new Map<string, { roomId: string; userInfo: any }>();
  calls: string[] = [];
  /** Fail the next calls whose path matches. */
  failures: { match: RegExp; status: number; times: number }[] = [];
  /** Send Content-Length on recording downloads (off = chunked, like some proxies). */
  sendLength = true;
  private server!: Server;
  private n = 0;

  constructor(readonly apiKey: string, readonly secret: string) {}

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }

  fail(match: RegExp, status: number, times = 1) {
    this.failures.push({ match, status, times });
  }

  join(roomId: string, identity: string, name: string) {
    this.rooms.get(roomId)!.participants.set(identity, { identity, name, joinedAt: Math.floor(Date.now() / 1000) });
  }

  leave(roomId: string, identity: string) {
    this.rooms.get(roomId)?.participants.delete(identity);
  }

  /** The room closes (everyone left and plugNmeet's empty timeout passed). */
  close(roomId: string) {
    const r = this.rooms.get(roomId);
    if (r) { r.active = false; r.participants.clear(); }
  }

  addRecording(roomId: string, bytes: Buffer) {
    const recordId = `REC_${++this.n}_${randomBytes(4).toString('hex')}`;
    this.recordings.set(recordId, { recordId, roomId, roomSid: this.rooms.get(roomId)?.sid ?? 'RM_x', bytes, creationTime: Math.floor(Date.now() / 1000) });
    return recordId;
  }

  private send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const path = (req.url ?? '').split('?')[0];
    this.calls.push(`${req.method} ${path}`);
    const f = this.failures.find((x) => x.times > 0 && x.match.test(path));
    if (f) { f.times--; return this.send(res, f.status, { status: false, msg: 'simulated failure', statusCode: 'INTERNAL_SERVER_ERROR' }); }

    if (req.method === 'GET' && path.startsWith('/download/recording/')) {
      const id = this.downloadTokens.get(decodeURIComponent(path.slice('/download/recording/'.length)));
      const rec = id && this.recordings.get(id);
      if (!rec) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, this.sendLength ? { 'Content-Type': 'video/mp4', 'Content-Length': String(rec.bytes.length) } : { 'Content-Type': 'video/mp4' });
      return res.end(rec.bytes);
    }
    if (req.method !== 'POST' || !path.startsWith('/auth/')) { res.writeHead(404); return res.end(); }

    const sig = createHmac('sha256', this.secret).update(raw).digest('hex');
    if (req.headers['api-key'] !== this.apiKey) return this.send(res, 401, { status: false, msg: 'invalid api key', statusCode: 'INVALID_API_KEY' });
    if (req.headers['hash-signature'] !== sig) return this.send(res, 401, { status: false, msg: 'invalid signature', statusCode: 'INVALID_TOKEN_OR_SIGNATURE' });
    const b = raw ? JSON.parse(raw) : {};
    const ok = (extra: Record<string, unknown> = {}) => this.send(res, 200, { status: true, msg: 'success', statusCode: 'SUCCESS', ...extra });
    const notActive = () => this.send(res, 200, { status: false, msg: 'room is not active', statusCode: 'ROOM_NOT_ACTIVE' });
    const info = (r: SimRoom) => ({ roomTitle: r.metadata?.roomTitle ?? '', roomId: r.roomId, sid: r.sid, joinedParticipants: String(r.participants.size), isRunning: 1, isRecording: 0, isActiveRtmp: 0, webhookUrl: r.metadata?.webhookUrl ?? '', isBreakoutRoom: 0, parentRoomId: '', creationTime: String(Math.floor(Date.now() / 1000)), metadata: JSON.stringify(r.metadata ?? {}) });

    switch (path) {
      case '/auth/room/create': {
        if (!b.roomId) return this.send(res, 200, { status: false, msg: 'roomId required', statusCode: 'MISSING_REQUIRED_PARAMETER' });
        const room: SimRoom = { roomId: b.roomId, sid: `RM_${++this.n}`, active: true, metadata: b.metadata, emptyTimeout: b.emptyTimeout, maxParticipants: b.maxParticipants, participants: new Map() };
        this.rooms.set(b.roomId, room);
        return ok({ roomInfo: info(room) });
      }
      case '/auth/room/isRoomActive': {
        const r = this.rooms.get(b.roomId);
        return r?.active ? ok({ isActive: true }) : notActive();
      }
      case '/auth/room/getJoinToken': {
        const r = this.rooms.get(b.roomId);
        if (!r?.active) return notActive();
        const token = `pnm.${randomBytes(12).toString('hex')}`;
        this.joinTokens.set(token, { roomId: b.roomId, userInfo: b.userInfo });
        return ok({ token });
      }
      case '/auth/room/getActiveRoomInfo': {
        const r = this.rooms.get(b.roomId);
        if (!r?.active) return notActive();
        return ok({ room: { roomInfo: info(r), participantsInfo: [...r.participants.values()].map((p) => ({ sid: `PA_${p.identity}`, identity: p.identity, name: p.name, joinedAt: String(p.joinedAt), state: 'ACTIVE', metadata: '' })) } });
      }
      case '/auth/room/endRoom': {
        const r = this.rooms.get(b.roomId);
        if (!r?.active) return notActive();
        this.close(b.roomId);
        return ok();
      }
      case '/auth/recording/fetch': {
        const list = [...this.recordings.values()].filter((x) => (b.roomIds ?? []).includes(x.roomId));
        return ok({ result: { totalRecordings: String(list.length), from: b.from ?? 0, limit: b.limit ?? 20, orderBy: b.orderBy ?? 'DESC', recordingsList: list.map((x) => ({ recordId: x.recordId, roomId: x.roomId, roomSid: x.roomSid, filePath: `recordings/${x.recordId}.mp4`, fileSize: x.bytes.length / (1024 * 1024), creationTime: String(x.creationTime), roomCreationTime: String(x.creationTime) })) } });
      }
      case '/auth/recording/getDownloadToken': {
        if (!this.recordings.has(b.recordId)) return this.send(res, 200, { status: false, msg: 'recording not found', statusCode: 'NOT_FOUND' });
        const token = randomBytes(16).toString('hex');
        this.downloadTokens.set(token, b.recordId);
        return ok({ token });
      }
      default:
        res.writeHead(404);
        return res.end();
    }
  }
}
