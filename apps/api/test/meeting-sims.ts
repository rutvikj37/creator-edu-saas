import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
async function listen(server: Server, port = 0) {
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * Local Zoom for the e2e suite: OAuth token endpoint (HTTP Basic client credentials, refresh-token
 * rotation), the REST endpoints our client calls (`/v2/users/me`, meetings, registrants) with the
 * field names of Zoom's official SDK (`@zoom/rivet`), Zoom-style `{code, message}` errors, and
 * cloud-recording downloads gated by `access_token`. Also signs webhooks like Zoom.
 */
export class ZoomSim {
  url = '';
  codes = new Map<string, string>();
  refreshTokens = new Set<string>();
  accessTokens = new Map<string, number>(); // token → expiry ms
  meetings = new Map<string, any>();
  registrants = new Map<string, { meetingId: string; email: string; first_name: string; last_name?: string; join_url: string }>();
  files = new Map<string, Buffer>();
  downloadTokens = new Set<string>();
  calls: string[] = [];
  /** Basic (free) account: registration is not allowed. */
  basicAccount = false;
  user = { id: 'zu_HostUser1', email: 'host@zoom.example', account_id: 'za_Account1' };
  private server!: Server;
  private n = 81000000000;

  constructor(readonly clientId: string, readonly clientSecret: string, readonly webhookSecret: string) {}

  /** Listens on the port of ZOOM_OAUTH_BASE_URL (fixed in test/setup-env.ts). */
  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.url = await listen(this.server, Number(new URL(process.env.ZOOM_OAUTH_BASE_URL!).port));
    return this;
  }
  stop() { return new Promise<void>((r) => this.server.close(() => r())); }

  issueCode() {
    const code = `zc_${randomBytes(6).toString('hex')}`;
    this.codes.set(code, `zr_${randomBytes(8).toString('hex')}`);
    return code;
  }

  /** Signed webhook request as Zoom sends it. */
  webhook(body: Record<string, unknown>) {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    return { raw, headers: { 'x-zm-request-timestamp': ts, 'x-zm-signature': `v0=${createHmac('sha256', this.webhookSecret).update(`v0:${ts}:${raw}`).digest('hex')}` } };
  }

  addRecordingFile(bytes: Buffer) {
    const id = `rf_${randomBytes(5).toString('hex')}`;
    this.files.set(id, bytes);
    const token = `dt_${randomBytes(8).toString('hex')}`;
    this.downloadTokens.add(token);
    return { id, downloadUrl: `${this.url}/rec/download/${id}`, token };
  }

  private bearer(req: IncomingMessage) {
    const t = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const exp = this.accessTokens.get(t);
    return exp !== undefined && exp > Date.now();
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url!, this.url);
    const method = req.method!;
    this.calls.push(`${method} ${u.pathname}`);
    if (u.pathname === '/oauth/token' && method === 'POST') {
      const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      if (req.headers.authorization !== `Basic ${basic}`) return send(res, 401, { reason: 'Invalid client_id or client_secret', error: 'invalid_client' });
      const p = new URLSearchParams(await readBody(req));
      let refresh: string;
      if (p.get('grant_type') === 'authorization_code') {
        const r = this.codes.get(p.get('code') ?? '');
        if (!r || !p.get('redirect_uri')) return send(res, 400, { reason: 'Invalid authorization code', error: 'invalid_request' });
        this.codes.delete(p.get('code')!);
        refresh = r;
      } else if (p.get('grant_type') === 'refresh_token') {
        const old = p.get('refresh_token') ?? '';
        if (!this.refreshTokens.has(old)) return send(res, 400, { reason: 'Invalid Token!', error: 'invalid_request' });
        this.refreshTokens.delete(old); // Zoom rotates refresh tokens
        refresh = `zr_${randomBytes(8).toString('hex')}`;
      } else return send(res, 400, { error: 'unsupported_grant_type' });
      this.refreshTokens.add(refresh);
      const access = `za_${randomBytes(8).toString('hex')}`;
      this.accessTokens.set(access, Date.now() + 3600_000);
      return send(res, 200, { access_token: access, token_type: 'bearer', refresh_token: refresh, expires_in: 3599, scope: 'meeting:write:meeting meeting:write:registrant user:read:user' });
    }
    const dl = /^\/rec\/download\/([\w-]+)$/.exec(u.pathname);
    if (dl && method === 'GET') {
      if (!this.downloadTokens.has(u.searchParams.get('access_token') ?? '')) return send(res, 401, { code: 124, message: 'Invalid access token.' });
      const b = this.files.get(dl[1]);
      if (!b) return send(res, 404, { code: 3301, message: 'This recording does not exist.' });
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(b.length) });
      return res.end(b);
    }
    if (!u.pathname.startsWith('/v2/')) return send(res, 404);
    if (!this.bearer(req)) return send(res, 401, { code: 124, message: 'Invalid access token.' });
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    if (u.pathname === '/v2/users/me' && method === 'GET') return send(res, 200, { ...this.user, first_name: 'Host', last_name: 'User', type: this.basicAccount ? 1 : 2 });
    if (u.pathname === '/v2/users/me/meetings' && method === 'POST') {
      if (this.basicAccount && body.settings?.approval_type === 0) return send(res, 400, { code: 3000, message: 'Registration is only available for licensed users.' });
      const id = String(++this.n);
      const m = { id: Number(id), uuid: randomBytes(8).toString('base64'), host_id: this.user.id, topic: body.topic, type: body.type, start_time: body.start_time, duration: body.duration, timezone: body.timezone, agenda: body.agenda, settings: body.settings, join_url: `https://zoom.example/j/${id}?pwd=abc`, start_url: `https://zoom.example/s/${id}?zak=${randomBytes(6).toString('hex')}`, password: 'abc123' };
      this.meetings.set(id, m);
      return send(res, 201, m);
    }
    const mm = /^\/v2\/meetings\/(\d+)(\/registrants)?$/.exec(u.pathname);
    if (mm) {
      const m = this.meetings.get(mm[1]);
      if (!m) return send(res, 404, { code: 3001, message: 'Meeting does not exist.' });
      if (mm[2] && method === 'POST') {
        if (m.settings?.approval_type !== 0) return send(res, 400, { code: 3000, message: 'Registration has not been enabled for this meeting.' });
        const rid = `zr${randomBytes(5).toString('hex')}`;
        const join = `https://zoom.example/w/${mm[1]}?tk=${rid}`;
        this.registrants.set(rid, { meetingId: mm[1], email: body.email, first_name: body.first_name, last_name: body.last_name, join_url: join });
        return send(res, 201, { id: Number(mm[1]), registrant_id: rid, join_url: join, topic: m.topic, start_time: m.start_time });
      }
      if (method === 'GET') return send(res, 200, { ...m, start_url: `https://zoom.example/s/${mm[1]}?zak=${randomBytes(6).toString('hex')}` });
      if (method === 'PATCH') { Object.assign(m, { topic: body.topic ?? m.topic, start_time: body.start_time ?? m.start_time, duration: body.duration ?? m.duration, settings: { ...m.settings, ...body.settings } }); return send(res, 204); }
      if (method === 'DELETE') { this.meetings.delete(mm[1]); return send(res, 204); }
    }
    return send(res, 404, { code: 300, message: 'Not found' });
  }
}

/** Local Google: OAuth token endpoint (issues an ID token with the email) and Calendar v3 events with Meet conferences. */
export class GoogleCalendarSim {
  url = '';
  codes = new Map<string, string>();
  refreshTokens = new Set<string>();
  accessTokens = new Set<string>();
  revoked: string[] = [];
  events = new Map<string, any>();
  /** Busy intervals returned by free/busy queries. */
  busy: { start: string; end: string }[] = [];
  calls: string[] = [];
  email = 'teacher@gmail.example';
  /** Scopes the user grants on the consent screen. */
  scope = 'openid email https://www.googleapis.com/auth/calendar.events.owned';
  private server!: Server;

  constructor(readonly clientId: string, readonly clientSecret: string) {}

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.url = await listen(this.server);
    return this;
  }
  stop() { return new Promise<void>((r) => this.server.close(() => r())); }

  issueCode() {
    const code = `gc_${randomBytes(6).toString('hex')}`;
    this.codes.set(code, `gr_${randomBytes(8).toString('hex')}`);
    return code;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url!, this.url);
    const method = req.method!;
    this.calls.push(`${method} ${u.pathname}${u.search}`);
    const raw = await readBody(req);
    if (u.pathname === '/token' && method === 'POST') {
      const p = new URLSearchParams(raw);
      if (p.get('client_id') !== this.clientId || p.get('client_secret') !== this.clientSecret) return send(res, 401, { error: 'invalid_client' });
      let refresh: string | undefined;
      if (p.get('grant_type') === 'authorization_code') {
        refresh = this.codes.get(p.get('code') ?? '');
        if (!refresh) return send(res, 400, { error: 'invalid_grant' });
        this.codes.delete(p.get('code')!);
        this.refreshTokens.add(refresh);
      } else if (p.get('grant_type') === 'refresh_token') {
        if (!this.refreshTokens.has(p.get('refresh_token') ?? '')) return send(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      } else return send(res, 400, { error: 'unsupported_grant_type' });
      const access = `ga_${randomBytes(8).toString('hex')}`;
      this.accessTokens.add(access);
      const idToken = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ email: this.email, sub: 'g-sub-123' })).toString('base64url')}.sig`;
      return send(res, 200, { access_token: access, expires_in: 3599, token_type: 'Bearer', scope: this.scope, id_token: idToken, ...(refresh && p.get('grant_type') === 'authorization_code' ? { refresh_token: refresh } : {}) });
    }
    if (u.pathname === '/revoke') {
      const t = new URLSearchParams(raw).get('token') ?? u.searchParams.get('token') ?? '';
      this.revoked.push(t);
      this.refreshTokens.delete(t);
      return send(res, 200, {});
    }
    if (!this.accessTokens.has((req.headers.authorization ?? '').replace(/^Bearer /, ''))) return send(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } });
    const body = raw ? JSON.parse(raw) : {};
    if (u.pathname === '/calendar/v3/calendars/primary/events' && method === 'POST') {
      if (u.searchParams.get('conferenceDataVersion') !== '1' || body.conferenceData?.createRequest?.conferenceSolutionKey?.type !== 'hangoutsMeet') return send(res, 200, { id: `ev${randomBytes(4).toString('hex')}`, ...body });
      const id = `ev${randomBytes(6).toString('hex')}`;
      const code = `${randomBytes(2).toString('hex')}-${randomBytes(2).toString('hex')}-${randomBytes(2).toString('hex')}`;
      const ev = { id, ...body, hangoutLink: `https://meet.google.com/${code}`, conferenceData: { conferenceId: code, conferenceSolution: { key: { type: 'hangoutsMeet' } }, entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/${code}` }] }, sendUpdates: u.searchParams.get('sendUpdates') };
      this.events.set(id, ev);
      return send(res, 200, ev);
    }
    if (u.pathname === '/calendar/v3/freeBusy' && method === 'POST') {
      const from = Date.parse(body.timeMin);
      const to = Date.parse(body.timeMax);
      return send(res, 200, { kind: 'calendar#freeBusy', timeMin: body.timeMin, timeMax: body.timeMax, calendars: { primary: { busy: this.busy.filter((b) => Date.parse(b.end) > from && Date.parse(b.start) < to) } } });
    }
    const em = /^\/calendar\/v3\/calendars\/primary\/events\/([\w]+)$/.exec(u.pathname);
    if (em) {
      const ev = this.events.get(em[1]);
      if (!ev) return send(res, 404, { error: { code: 404, message: 'Not Found' } });
      if (method === 'PATCH') { Object.assign(ev, body); return send(res, 200, ev); }
      if (method === 'DELETE') { this.events.delete(em[1]); return send(res, 204); }
    }
    return send(res, 404, { error: { code: 404, message: 'Not Found' } });
  }
}
