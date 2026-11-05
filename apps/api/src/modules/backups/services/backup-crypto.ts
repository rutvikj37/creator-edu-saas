import { createCipheriv, createDecipheriv, createHash, randomBytes, type CipherGCM, type DecipherGCM } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

/**
 * Backup file format (v1):  "TXB1" | 0x01 | IV (12 bytes) | AES-256-GCM ciphertext | tag (16 bytes)
 * Each file has its own random 256-bit data key; the data key is stored only wrapped (AES-256-GCM)
 * with BACKUP_ENCRYPTION_KEY, in the database and in the Drive metadata file. Without the master key
 * a backup cannot be decrypted — keep BACKUP_ENCRYPTION_KEY in an offline vault as well.
 */
export const BACKUP_MAGIC = Buffer.from('TXB1');
const VERSION = 1;
const HEADER = BACKUP_MAGIC.length + 1 + 12;
const TAG = 16;

export interface WrappedKey { alg: 'aes-256-gcm'; format: 'TXB1'; keyVersion: 1; wrappedKey: string; wrapIv: string; wrapTag: string }

export function wrapKey(dataKey: Buffer, master: Buffer): WrappedKey {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', master, iv);
  const wrapped = Buffer.concat([c.update(dataKey), c.final()]);
  return { alg: 'aes-256-gcm', format: 'TXB1', keyVersion: 1, wrappedKey: wrapped.toString('base64'), wrapIv: iv.toString('base64'), wrapTag: c.getAuthTag().toString('base64') };
}

export function unwrapKey(w: WrappedKey, master: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', master, Buffer.from(w.wrapIv, 'base64'));
  d.setAuthTag(Buffer.from(w.wrapTag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(w.wrappedKey, 'base64')), d.final()]);
}

/** Encrypts while measuring both sides: plaintext SHA-256/size and ciphertext MD5/size. */
export class EncryptStream extends Transform {
  readonly plainSha256 = createHash('sha256');
  readonly cipherMd5 = createHash('md5');
  plainBytes = 0;
  cipherBytes = 0;
  private readonly cipher: CipherGCM;
  private headerSent = false;
  private readonly iv = randomBytes(12);

  constructor(dataKey: Buffer) {
    super();
    this.cipher = createCipheriv('aes-256-gcm', dataKey, this.iv);
  }

  private out(chunk: Buffer) {
    if (!chunk.length) return;
    this.cipherMd5.update(chunk);
    this.cipherBytes += chunk.length;
    this.push(chunk);
  }

  private header() {
    if (this.headerSent) return;
    this.headerSent = true;
    this.out(Buffer.concat([BACKUP_MAGIC, Buffer.from([VERSION]), this.iv]));
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.header();
    this.plainSha256.update(chunk);
    this.plainBytes += chunk.length;
    this.out(this.cipher.update(chunk));
    cb();
  }

  override _flush(cb: TransformCallback) {
    this.header();
    this.out(this.cipher.final());
    this.out(this.cipher.getAuthTag());
    cb();
  }

  result() {
    return { plainSha256: this.plainSha256.digest('hex'), plainBytes: this.plainBytes, cipherMd5: this.cipherMd5.digest('hex'), cipherBytes: this.cipherBytes };
  }
}

/**
 * Decrypts a TXB1 stream. Plaintext is emitted before the tag is checked (GCM streaming), so callers
 * that act on the data must verify first: run a verification pass (sink the output, wait for 'finish'
 * without error, compare `plainSha256`) before restoring.
 */
export class DecryptStream extends Transform {
  readonly plainSha256 = createHash('sha256');
  plainBytes = 0;
  private decipher: DecipherGCM | null = null;
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);

  constructor(private readonly dataKey: Buffer) {
    super();
  }

  private pushPlain(b: Buffer) {
    if (!b.length) return;
    this.plainSha256.update(b);
    this.plainBytes += b.length;
    this.push(b);
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    try {
      let data = chunk;
      if (!this.decipher) {
        this.head = Buffer.concat([this.head, data]);
        if (this.head.length < HEADER) return cb();
        if (!this.head.subarray(0, 4).equals(BACKUP_MAGIC) || this.head[4] !== VERSION) throw new Error('Not a TXB1 backup file');
        this.decipher = createDecipheriv('aes-256-gcm', this.dataKey, this.head.subarray(5, HEADER));
        data = this.head.subarray(HEADER);
      }
      // Hold back the last 16 bytes: they may be the authentication tag.
      const all = Buffer.concat([this.tail, data]);
      const cut = Math.max(0, all.length - TAG);
      this.tail = all.subarray(cut);
      this.pushPlain(this.decipher.update(all.subarray(0, cut)));
      cb();
    } catch (e) {
      cb(e as Error);
    }
  }

  override _flush(cb: TransformCallback) {
    try {
      if (!this.decipher || this.tail.length !== TAG) throw new Error('Backup file is truncated');
      this.decipher.setAuthTag(this.tail);
      this.pushPlain(this.decipher.final());
      cb();
    } catch (e) {
      cb(e instanceof Error && /auth/i.test(e.message) ? new Error('Backup file failed integrity check (wrong key or tampered)') : (e as Error));
    }
  }
}
