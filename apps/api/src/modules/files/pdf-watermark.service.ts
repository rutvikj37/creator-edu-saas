import { Controller, Get, Inject, Injectable, Logger, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { Public } from '../../common/decorators/public.decorator.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { AcademySecurityService } from '../../core/security/academy-security.service.js';
import { StorageService } from '../../core/storage/storage.service.js';

/** PDFs larger than this are served as-is (watermarking happens in memory). */
export const WATERMARK_MAX_BYTES = 50 * 1024 * 1024;
const TTL = 600;

type Asset = { id: string; tenantId: string; mimeType: string; sizeBytes: bigint | number; fileName: string; storageKey?: string; status: string } & Record<string, unknown>;
type Viewer = { id: string; email: string; phone?: string | null };

const hex = (c: string) => { const n = parseInt(c.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
/** Standard PDF fonts are WinAnsi-only. */
const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, '?');

/** Stamps each page with the viewer's email and phone (and optionally a learner code) — see Settings → Security. */
export async function watermarkPdf(bytes: Buffer, viewer: Viewer, opts: { color: string; fixedPosition: boolean }): Promise<Buffer> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const color = hex(opts.color);
  const label = safe(`${viewer.email}${viewer.phone ? ` · ${viewer.phone}` : ''}`);
  const code = `ID ${viewer.id.slice(-8).toUpperCase()}`;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const small = Math.max(7, Math.min(10, width / 70));
    const w = font.widthOfTextAtSize(label, small);
    page.drawText(label, { x: (width - w) / 2, y: 14, size: small, font, color, opacity: 0.55 });
    page.drawText(label, { x: (width - w) / 2, y: height - 20, size: small, font, color, opacity: 0.55 });
    const big = Math.min(width, height) / 14;
    const text = opts.fixedPosition ? code : label;
    const bw = font.widthOfTextAtSize(text, big);
    page.drawText(text, { x: width / 2 - (bw / 2) * Math.SQRT1_2, y: height / 2 - (bw / 2) * Math.SQRT1_2, size: big, font, color, opacity: opts.fixedPosition ? 0.18 : 0.1, rotate: degrees(45) });
  }
  return Buffer.from(await doc.save());
}

@Injectable()
export class PdfWatermarkService {
  private readonly log = new Logger(PdfWatermarkService.name);
  constructor(
    private readonly security: AcademySecurityService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** True when this file would be served watermarked for its academy. */
  async applies(asset: Pick<Asset, 'tenantId' | 'mimeType' | 'sizeBytes'>) {
    if (asset.mimeType !== 'application/pdf' || Number(asset.sizeBytes) > WATERMARK_MAX_BYTES) return false;
    return (await this.security.get(asset.tenantId)).pdfWatermark.enabled;
  }

  /** A short-lived link that serves the PDF stamped for this viewer, or null when watermarking is off. */
  async link(asset: Asset, viewerId: string, apiOrigin: string, download = false) {
    if (!(await this.applies(asset))) return null;
    const token = randomBytes(24).toString('base64url');
    await this.redis.set(`pdf-wm:${token}`, JSON.stringify({ fileId: asset.id, tenantId: asset.tenantId, viewerId, download }), 'EX', TTL);
    return `${apiOrigin.replace(/\/+$/, '')}/api/v1/public/watermarked/${token}`;
  }

  async render(token: string) {
    const raw = await this.redis.get(`pdf-wm:${token.slice(0, 64)}`);
    if (!raw) throw AppException.notFound('This link has expired. Open the file again from the course.');
    const t = JSON.parse(raw) as { fileId: string; tenantId: string; viewerId: string; download: boolean };
    const [asset, viewer, sec] = await Promise.all([
      this.prisma.fileAsset.findFirst({ where: { id: t.fileId, tenantId: t.tenantId, status: 'READY' } }),
      this.prisma.user.findUnique({ where: { id: t.viewerId }, select: { id: true, email: true, phone: true } }),
      this.security.get(t.tenantId),
    ]);
    if (!asset || !viewer) throw AppException.notFound('File not available');
    const chunks: Buffer[] = [];
    for await (const c of await this.storage.readStream(asset as never)) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
    const pdf = await watermarkPdf(Buffer.concat(chunks), viewer, sec.pdfWatermark).catch((e) => {
      this.log.warn(`watermark ${asset.id}: ${(e as Error).message}`);
      throw AppException.conflict('This PDF could not be prepared for viewing. Ask the academy to re-upload it.');
    });
    return { pdf, fileName: asset.fileName, download: t.download };
  }
}

@ApiExcludeController()
@Public()
@Controller({ path: 'public/watermarked', version: '1' })
export class WatermarkedFileController {
  constructor(private readonly wm: PdfWatermarkService) {}

  @Get(':token')
  async get(@Param('token') token: string, @Res() res: Response) {
    const out = await this.wm.render(token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${out.download ? 'attachment' : 'inline'}; filename="${out.fileName.replace(/[^\w.\- ]+/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(out.pdf);
  }
}
