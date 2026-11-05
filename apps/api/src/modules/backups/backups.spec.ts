import { createHash, randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DecryptStream, EncryptStream, unwrapKey, wrapKey } from './services/backup-crypto.js';
import { classifyDriveError } from './providers/google-drive/google-drive.service.js';
import { BackupVerificationService } from './services/backup-verification.service.js';

async function collect(src: Readable, t: NodeJS.ReadWriteStream) {
  const out: Buffer[] = [];
  await pipeline(src, t, new Writable({ write(c, _e, cb) { out.push(c); cb(); } }));
  return Buffer.concat(out);
}
const chunks = (b: Buffer, size: number) => Readable.from(Array.from({ length: Math.ceil(b.length / size) }, (_, i) => b.subarray(i * size, (i + 1) * size)));

describe('backup encryption (TXB1)', () => {
  const key = randomBytes(32);
  const plain = randomBytes(1_000_003);

  it('round-trips in arbitrary chunk sizes and measures both sides', async () => {
    const enc = new EncryptStream(key);
    const cipher = await collect(chunks(plain, 65_537), enc);
    const m = enc.result();
    expect(cipher.subarray(0, 4).toString()).toBe('TXB1');
    expect(m).toEqual({ plainSha256: createHash('sha256').update(plain).digest('hex'), plainBytes: plain.length, cipherMd5: createHash('md5').update(cipher).digest('hex'), cipherBytes: cipher.length });
    expect(cipher.length).toBe(plain.length + 4 + 1 + 12 + 16);
    for (const size of [3, 7, 16, 17, 4096, 100_000]) {
      const dec = new DecryptStream(key);
      expect((await collect(chunks(cipher, size), dec)).equals(plain)).toBe(true);
    }
  });
  it('detects tampering, truncation and the wrong key', async () => {
    const cipher = await collect(Readable.from([plain]), new EncryptStream(key));
    const bad = Buffer.from(cipher);
    bad[5000] ^= 1;
    await expect(collect(Readable.from([bad]), new DecryptStream(key))).rejects.toThrow(/integrity/);
    await expect(collect(Readable.from([cipher.subarray(0, cipher.length - 3)]), new DecryptStream(key))).rejects.toThrow(/integrity|truncated/);
    await expect(collect(Readable.from([cipher]), new DecryptStream(randomBytes(32)))).rejects.toThrow(/integrity/);
    await expect(collect(Readable.from([Buffer.from('not a backup at all')]), new DecryptStream(key))).rejects.toThrow(/TXB1/);
  });
  it('wraps data keys with the master key', () => {
    const master = randomBytes(32);
    const w = wrapKey(key, master);
    expect(JSON.stringify(w)).not.toContain(key.toString('base64'));
    expect(unwrapKey(w, master).equals(key)).toBe(true);
    expect(() => unwrapKey(w, randomBytes(32))).toThrow();
  });
});

describe('Drive error classification', () => {
  const g = (status: number, reason: string, message = 'x') => ({ response: { status, data: { error: { message, errors: [{ reason }] } } } });
  it('retries rate limits and server errors only', () => {
    expect(classifyDriveError(g(403, 'userRateLimitExceeded')).retryable).toBe(true);
    expect(classifyDriveError(g(429, 'rateLimitExceeded')).retryable).toBe(true);
    expect(classifyDriveError(g(503, 'backendError')).retryable).toBe(true);
    expect(classifyDriveError(g(403, 'storageQuotaExceeded'))).toMatchObject({ retryable: false, message: 'Google Drive is full' });
    expect(classifyDriveError(g(401, 'authError')).message).toMatch(/Reconnect/);
    expect(classifyDriveError(new Error('invalid_grant')).message).toMatch(/Reconnect/);
    expect(classifyDriveError(new Error('connect ECONNREFUSED')).retryable).toBe(true);
  });
});

describe('upload verification', () => {
  const v = new BackupVerificationService({} as never);
  const m = { plainSha256: 'a'.repeat(64), plainBytes: 10, cipherMd5: 'b'.repeat(32), cipherBytes: 43 };
  it('accepts matching size/checksums and reports each mismatch', () => {
    expect(v.checkUpload(m, { fileId: 'f', size: 43, md5Checksum: 'B'.repeat(32), sha256Checksum: null }, { originalSize: 10, providerSha256: 'A'.repeat(64) })).toEqual([]);
    expect(v.checkUpload(m, { fileId: 'f', size: 44, md5Checksum: 'c'.repeat(32), sha256Checksum: null }, { originalSize: 11, providerSha256: 'c'.repeat(64) })).toHaveLength(4);
    expect(v.checkUpload(m, { fileId: 'f', size: null, md5Checksum: null, sha256Checksum: null }, {})).toEqual(['the backup store returned no size or checksum to verify']);
  });
});
