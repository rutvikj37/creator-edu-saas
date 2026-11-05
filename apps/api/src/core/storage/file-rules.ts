/**
 * Upload rules per purpose: allowed MIME types and maximum size. The declared type is
 * checked here and the actual bytes are verified with magic numbers after upload.
 * SVG is deliberately not allowed (it can carry script).
 */
const MB = 1024 * 1024;
const IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const DOCS = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'text/plain',
  'text/csv',
];
const AUDIO = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav'];
const VIDEO = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];

export const FILE_RULES: Record<string, { mime: string[]; maxBytes: number; public: boolean }> = {
  LOGO: { mime: IMAGES, maxBytes: 2 * MB, public: true },
  FAVICON: { mime: ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'], maxBytes: 512 * 1024, public: true },
  IMAGE: { mime: IMAGES, maxBytes: 10 * MB, public: true },
  COURSE_THUMBNAIL: { mime: IMAGES, maxBytes: 5 * MB, public: true },
  COURSE_BANNER: { mime: IMAGES, maxBytes: 10 * MB, public: true },
  LESSON_FILE: { mime: [...DOCS, ...IMAGES, ...AUDIO], maxBytes: 500 * MB, public: false },
  /** Digital products (e-books, templates, packs). EPUB is a ZIP container. */
  PRODUCT_FILE: { mime: [...DOCS, 'application/epub+zip', ...IMAGES, ...AUDIO], maxBytes: 2 * 1024 * MB, public: false },
  VIDEO_SOURCE: { mime: VIDEO, maxBytes: 20 * 1024 * MB, public: false },
  SUBMISSION: { mime: [...DOCS, ...IMAGES], maxBytes: 50 * MB, public: false },
  OTHER: { mime: [...DOCS, ...IMAGES], maxBytes: 50 * MB, public: false },
};

const SIGNATURES: Array<{ mime: string[]; test: (b: Buffer) => boolean }> = [
  { mime: ['image/png'], test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: ['image/jpeg'], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: ['image/gif'], test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { mime: ['image/webp'], test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: ['image/x-icon', 'image/vnd.microsoft.icon'], test: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 },
  { mime: ['application/pdf'], test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  {
    mime: [
      'application/zip',
      'application/epub+zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
  { mime: ['audio/mpeg'], test: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { mime: ['audio/wav'], test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  { mime: ['video/mp4', 'video/quicktime', 'audio/mp4', 'audio/x-m4a'], test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { mime: ['video/webm', 'video/x-matroska'], test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
];

/** True when the first bytes match the declared MIME type. Plain text/CSV must be valid UTF-8 without NUL bytes. */
export function matchesSignature(mime: string, head: Buffer): boolean {
  if (mime === 'text/plain' || mime === 'text/csv') {
    return !head.includes(0) && Buffer.from(head.toString('utf8'), 'utf8').length >= head.length - 3;
  }
  const sig = SIGNATURES.find((s) => s.mime.includes(mime));
  return sig ? sig.test(head) : false;
}

export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFKC').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'file').slice(0, 200);
}

/** S3 multipart plan: parts of at least 8 MiB, at most 10,000 parts. */
export const MULTIPART_THRESHOLD = 100 * MB;
export function multipartPlan(sizeBytes: number) {
  const partSize = Math.max(8 * MB, Math.ceil(sizeBytes / 10_000 / MB) * MB);
  return { partSize, partCount: Math.ceil(sizeBytes / partSize) };
}
