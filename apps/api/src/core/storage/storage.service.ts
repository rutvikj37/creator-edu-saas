import type { Readable } from 'node:stream';
import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
export { stat as statFile };
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, resolve, sep } from 'node:path';
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../../config/app-config.service.js';
import { safeEqual } from '../crypto/crypto.service.js';

export interface ObjectRef {
  driver: string;
  bucket: string;
  key: string;
}

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

/**
 * Object storage behind one interface.
 * - s3: browser uploads directly to S3 with a presigned PUT; downloads use presigned GETs.
 * - local: development only. Files are written under LOCAL_STORAGE_DIR via short-lived HMAC-signed
 *   API URLs, mirroring the S3 flow so the frontend is identical.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  readonly driver: 'local' | 's3';
  private readonly s3?: S3Client;
  private readonly root: string;
  private readonly signKey: string;

  constructor(private readonly config: AppConfig) {
    this.driver = config.get('STORAGE_DRIVER');
    this.root = resolve(config.get('LOCAL_STORAGE_DIR'));
    this.signKey = config.get('JWT_ACCESS_SECRET');
    if (this.driver === 's3') {
      this.s3 = new S3Client({
        region: config.get('AWS_REGION'),
        endpoint: config.get('S3_ENDPOINT') || undefined,
        forcePathStyle: Boolean(config.get('S3_ENDPOINT')),
        credentials: config.get('AWS_ACCESS_KEY_ID') ? { accessKeyId: config.get('AWS_ACCESS_KEY_ID')!, secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY')! } : undefined,
      });
    }
  }

  bucketFor(isPublic: boolean) {
    return this.driver === 'local' ? 'local' : isPublic ? this.config.get('S3_PUBLIC_BUCKET') : this.config.get('S3_PRIVATE_BUCKET');
  }

  // ── local signing ────────────────────────────────────────
  private sign(payload: string) {
    return createHmac('sha256', this.signKey).update(`storage:${payload}`).digest('base64url');
  }

  /** Token = base64url(json).signature, embedding op, key, expiry and (for uploads) size/type. */
  createLocalToken(data: { op: 'put' | 'get'; key: string; exp: number; size?: number; type?: string; name?: string }) {
    const body = Buffer.from(JSON.stringify(data)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  verifyLocalToken(token: string): { op: 'put' | 'get'; key: string; exp: number; size?: number; type?: string; name?: string } | null {
    const [body, sig] = token.split('.');
    if (!body || !sig || !safeEqual(sig, this.sign(body))) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  }

  private localPath(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }

  async writeLocal(key: string, data: Buffer) {
    const p = this.localPath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  /** Streams a server-side file into private storage (S3 single PUT needs the exact size; ≤ 5 GB). */
  async putStream(key: string, body: Readable, size: number, contentType: string) {
    if (this.driver === 'local') {
      const p = this.localPath(key);
      await mkdir(dirname(p), { recursive: true });
      await pipeline(body, createWriteStream(p));
      return;
    }
    await this.s3!.send(new PutObjectCommand({ Bucket: this.bucketFor(false), Key: key, Body: body, ContentLength: size, ContentType: contentType }));
  }

  localReadStream(key: string, range?: { start: number; end: number }) {
    return createReadStream(this.localPath(key), range);
  }

  async localSize(key: string) {
    return (await stat(this.localPath(key))).size;
  }

  /** Size of a stored object in the private bucket (S3) or local storage. */
  async objectSize(key: string): Promise<number> {
    if (this.driver === 'local') return this.localSize(key);
    const out = await this.s3!.send(new HeadObjectCommand({ Bucket: this.bucketFor(false), Key: key }));
    return Number(out.ContentLength ?? 0);
  }

  // ── multipart (S3 only; large videos) ────────────────────
  get supportsMultipart() {
    return this.driver === 's3';
  }

  async createMultipart(ref: ObjectRef, contentType: string): Promise<string> {
    const out = await this.s3!.send(new CreateMultipartUploadCommand({ Bucket: ref.bucket, Key: ref.key, ContentType: contentType }));
    return out.UploadId!;
  }

  signPart(ref: ObjectRef, uploadId: string, partNumber: number): Promise<string> {
    return getSignedUrl(this.s3!, new UploadPartCommand({ Bucket: ref.bucket, Key: ref.key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn: 3600 });
  }

  async completeMultipart(ref: ObjectRef, uploadId: string, parts: Array<{ partNumber: number; etag: string }>) {
    await this.s3!.send(new CompleteMultipartUploadCommand({
      Bucket: ref.bucket, Key: ref.key, UploadId: uploadId,
      MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }));
  }

  async abortMultipart(ref: ObjectRef, uploadId: string) {
    await this.s3!.send(new AbortMultipartUploadCommand({ Bucket: ref.bucket, Key: ref.key, UploadId: uploadId }));
  }

  // ── common API ───────────────────────────────────────────
  async uploadTarget(ref: ObjectRef, contentType: string, sizeBytes: number, apiOrigin: string): Promise<UploadTarget> {
    const ttl = 15 * 60_000;
    const expiresAt = new Date(Date.now() + ttl).toISOString();
    if (this.driver === 'local') {
      const token = this.createLocalToken({ op: 'put', key: ref.key, exp: Date.now() + ttl, size: sizeBytes, type: contentType });
      return { url: `${apiOrigin}/api/v1/files/local/${token}`, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt };
    }
    const url = await getSignedUrl(this.s3!, new PutObjectCommand({ Bucket: ref.bucket, Key: ref.key, ContentType: contentType, ContentLength: sizeBytes }), { expiresIn: ttl / 1000 });
    return { url, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt };
  }

  async downloadUrl(ref: ObjectRef & { mimeType?: string }, fileName: string, apiOrigin: string, ttlSeconds = 900, inline = true): Promise<string> {
    if (ref.driver === 'local') {
      const token = this.createLocalToken({ op: 'get', key: ref.key, exp: Date.now() + ttlSeconds * 1000, name: fileName, type: ref.mimeType });
      return `${apiOrigin}/api/v1/files/local/${token}${inline ? '' : '?download=1'}`;
    }
    const disposition = `${inline ? 'inline' : 'attachment'}; filename="${fileName.replace(/"/g, '')}"`;
    return getSignedUrl(this.s3!, new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key, ResponseContentDisposition: disposition }), { expiresIn: ttlSeconds });
  }

  /** Size and first bytes of a stored object (for verification after upload). */
  async inspect(ref: ObjectRef): Promise<{ size: number; head: Buffer } | null> {
    try {
      if (ref.driver === 'local') {
        const p = this.localPath(ref.key);
        const st = await stat(p);
        const fh = await open(p, 'r');
        const buf = Buffer.alloc(Math.min(64, st.size));
        await fh.read(buf, 0, buf.length, 0);
        await fh.close();
        return { size: st.size, head: buf };
      }
      const head = await this.s3!.send(new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.key }));
      const obj = await this.s3!.send(new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key, Range: 'bytes=0-63' }));
      const bytes = Buffer.from(await obj.Body!.transformToByteArray());
      return { size: Number(head.ContentLength ?? 0), head: bytes };
    } catch (e) {
      this.logger.warn({ key: ref.key, err: (e as Error).message }, 'object not found');
      return null;
    }
  }

  /** Streams a stored object (backups read originals this way). */
  async readStream(ref: ObjectRef): Promise<Readable> {
    if (ref.driver === 'local') return this.localReadStream(ref.key);
    const obj = await this.s3!.send(new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }));
    return obj.Body as Readable;
  }

  async remove(ref: ObjectRef) {
    if (ref.driver === 'local') await rm(this.localPath(ref.key), { force: true });
    else await this.s3!.send(new DeleteObjectCommand({ Bucket: ref.bucket, Key: ref.key }));
  }
}
