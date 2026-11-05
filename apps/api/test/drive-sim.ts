import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

interface DriveFile { id: string; name: string; mimeType: string; parents: string[]; appProperties: Record<string, string>; data: Buffer | null; trashed: boolean }

/**
 * Local stand-in for the Google OAuth token endpoint and the Drive v3 REST endpoints that the
 * official SDK (@googleapis/drive + google-auth-library) calls: files.list/create/get/delete,
 * multipart media upload, alt=media download, about.get. Response fields follow the Drive v3
 * resource (size and md5Checksum as strings, storageQuota values as strings). No network.
 */
export class DriveSim {
  server!: Server;
  url = '';
  files = new Map<string, DriveFile>();
  codes = new Map<string, string>(); // auth code -> refresh token
  refreshTokens = new Set<string>();
  accessTokens = new Set<string>();
  revoked: string[] = [];
  limit: number | null = 5 * 1024 ** 4;
  baseUsage = 1024 ** 3;
  email = 'owner@gmail.test';
  calls: string[] = [];
  failures: { match: RegExp; status: number; reason: string; times: number }[] = [];
  /** Corrupt stored bytes (simulates tampering/bit rot). */
  tamper(fileId: string) {
    const f = this.files.get(fileId)!;
    f.data![Math.floor(f.data!.length / 2)] ^= 0xff;
  }

  fail(match: RegExp, status: number, reason = 'backendError', times = 1) {
    this.failures.push({ match, status, reason, times });
  }

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res).catch((e) => this.send(res, 500, { error: { message: String(e) } })));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }

  /** Simulates the user approving consent: returns an authorization code. */
  issueCode() {
    const code = `code-${randomBytes(6).toString('hex')}`;
    this.codes.set(code, `rt-${randomBytes(8).toString('hex')}`);
    return code;
  }

  usage() {
    return this.baseUsage + [...this.files.values()].reduce((a, f) => a + (f.data?.length ?? 0), 0);
  }

  pathOf(id: string): string[] {
    const f = this.files.get(id);
    if (!f) return [];
    return [...(f.parents[0] && f.parents[0] !== 'root' ? this.pathOf(f.parents[0]) : []), f.name];
  }

  findByPath(path: string[]) {
    return [...this.files.values()].find((f) => this.pathOf(f.id).join('/') === path.join('/'));
  }

  private send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }

  private async body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  private view(f: DriveFile, fields: string | null) {
    const full: Record<string, unknown> = { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, appProperties: f.appProperties, ...(f.data ? { size: String(f.data.length), md5Checksum: createHash('md5').update(f.data).digest('hex'), sha256Checksum: createHash('sha256').update(f.data).digest('hex') } : {}) };
    if (!fields) return { id: f.id, name: f.name, mimeType: f.mimeType };
    return Object.fromEntries(fields.split(',').map((k) => k.trim()).filter((k) => k in full).map((k) => [k, full[k]]));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url!, this.url);
    const method = req.method!;
    this.calls.push(`${method} ${u.pathname}`);
    const f = this.failures.find((x) => x.times > 0 && x.match.test(`${method} ${u.pathname}`));
    if (f) {
      f.times--;
      await this.body(req);
      return this.send(res, f.status, { error: { code: f.status, message: `Simulated ${f.reason}`, errors: [{ reason: f.reason }] } });
    }
    if (u.pathname === '/token' && method === 'POST') {
      const p = new URLSearchParams((await this.body(req)).toString());
      if (p.get('client_id') !== process.env.GOOGLE_DRIVE_CLIENT_ID || p.get('client_secret') !== process.env.GOOGLE_DRIVE_CLIENT_SECRET) return this.send(res, 401, { error: 'invalid_client' });
      let refresh: string | undefined;
      if (p.get('grant_type') === 'authorization_code') {
        refresh = this.codes.get(p.get('code') ?? '');
        if (!refresh || p.get('redirect_uri') !== process.env.GOOGLE_DRIVE_REDIRECT_URI) return this.send(res, 400, { error: 'invalid_grant' });
        this.codes.delete(p.get('code')!);
        this.refreshTokens.add(refresh);
      } else if (p.get('grant_type') === 'refresh_token') {
        if (!this.refreshTokens.has(p.get('refresh_token') ?? '')) return this.send(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      } else return this.send(res, 400, { error: 'unsupported_grant_type' });
      const access = `at-${randomBytes(8).toString('hex')}`;
      this.accessTokens.add(access);
      return this.send(res, 200, { access_token: access, expires_in: 3599, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/drive.file', ...(refresh ? { refresh_token: refresh } : {}) });
    }
    if (u.pathname === '/revoke' && method === 'POST') {
      const t = u.searchParams.get('token') ?? new URLSearchParams((await this.body(req)).toString()).get('token') ?? '';
      this.revoked.push(t);
      this.refreshTokens.delete(t);
      return this.send(res, 200, {});
    }
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!this.accessTokens.has(bearer)) return this.send(res, 401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } });
    const fields = u.searchParams.get('fields');
    if (u.pathname === '/drive/v3/about' && method === 'GET') {
      const all = { storageQuota: { ...(this.limit !== null ? { limit: String(this.limit) } : {}), usage: String(this.usage()), usageInDrive: String(this.usage() - this.baseUsage / 2), usageInDriveTrash: '0' }, user: { emailAddress: this.email } };
      return this.send(res, 200, fields?.startsWith('user') ? { user: all.user } : { storageQuota: all.storageQuota });
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') ?? '';
      const name = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, '$1');
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      const items = [...this.files.values()].filter((x) => !x.trashed && (!name || x.name === name) && (!parent || x.parents.includes(parent)) && (!q.includes('folder') || x.mimeType === 'application/vnd.google-apps.folder'));
      return this.send(res, 200, { files: items.map((x) => ({ id: x.id, name: x.name })) });
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse((await this.body(req)).toString() || '{}');
      const file: DriveFile = { id: `f${randomBytes(8).toString('hex')}`, name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? ['root'], appProperties: meta.appProperties ?? {}, data: null, trashed: false };
      this.files.set(file.id, file);
      return this.send(res, 200, this.view(file, fields));
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      if (u.searchParams.get('uploadType') !== 'multipart') return this.send(res, 400, { error: { message: 'expected multipart' } });
      const boundary = (req.headers['content-type'] ?? '').match(/boundary=([^;]+)/)?.[1];
      const raw = await this.body(req);
      const parts = splitMultipart(raw, boundary!);
      const meta = JSON.parse(parts[0].body.toString());
      const data = parts[1].body;
      if (this.limit !== null && this.usage() + data.length > this.limit) return this.send(res, 403, { error: { code: 403, message: 'The user\'s Drive storage quota has been exceeded.', errors: [{ reason: 'storageQuotaExceeded' }] } });
      const file: DriveFile = { id: `f${randomBytes(8).toString('hex')}`, name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? ['root'], appProperties: meta.appProperties ?? {}, data, trashed: false };
      this.files.set(file.id, file);
      return this.send(res, 200, this.view(file, fields));
    }
    const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m) {
      const file = this.files.get(m[1]);
      if (!file) return this.send(res, 404, { error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } });
      if (method === 'DELETE') { this.files.delete(m[1]); res.writeHead(204); return res.end(); }
      if (u.searchParams.get('alt') === 'media') { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(file.data?.length ?? 0) }); return res.end(file.data); }
      return this.send(res, 200, this.view(file, fields));
    }
    return this.send(res, 404, { error: { message: `No route ${method} ${u.pathname}` } });
  }
}

function splitMultipart(raw: Buffer, boundary: string) {
  const sep = Buffer.from(`--${boundary}`);
  const out: { headers: string; body: Buffer }[] = [];
  let i = raw.indexOf(sep);
  while (i !== -1) {
    const next = raw.indexOf(sep, i + sep.length);
    if (next === -1) break;
    const part = raw.subarray(i + sep.length, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      let body = part.subarray(headerEnd + 4);
      if (body.subarray(-2).toString() === '\r\n') body = body.subarray(0, -2);
      out.push({ headers: part.subarray(0, headerEnd).toString(), body });
    }
    i = next;
  }
  return out;
}
