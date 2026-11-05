import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/** Unguessable, human-readable certificate number, e.g. CE-2026-7F3K9Q2M. */
export function certificateNumber(year = new Date().getUTCFullYear()): string {
  const bytes = randomBytes(8);
  return `CE-${year}-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Standard PDF fonts only encode WinAnsi; replace characters they can't draw. */
function pdfSafe(text: string) {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E -ÿ]/g, '?');
}

@Injectable()
export class CertificatesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async template() {
    return (await this.db.certificateTemplate.findFirst({})) ?? this.db.certificateTemplate.create({ data: {} as never });
  }

  async updateTemplate(data: { title?: string; bodyText?: string; signatoryName?: string | null; signatoryRole?: string | null; accentColor?: string; showQr?: boolean }, actorUserId: string) {
    const t = await this.template();
    const updated = await this.db.certificateTemplate.update({ where: { id: t.id }, data });
    await this.audit.record({ action: 'certificate.template_update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'CertificateTemplate', targetId: t.id, after: data });
    return updated;
  }

  /** Idempotent: one certificate per enrolment, snapshotting names at issue time. */
  async issueFor(enrollmentId: string) {
    const existing = await this.db.certificate.findFirst({ where: { enrollmentId } });
    if (existing) return existing;
    const e = await this.db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: { course: true } });
    const [user, tenant] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: e.userId }, select: { fullName: true } }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: e.tenantId }, select: { name: true } }),
    ]);
    for (let i = 0; i < 5; i++) {
      try {
        const cert = await this.db.certificate.create({
          data: { number: certificateNumber(), enrollmentId, userId: e.userId, courseId: e.courseId, recipientName: user.fullName, courseTitle: e.course.title, academyName: tenant.name } as never,
        });
        await this.notifications.notify({ userId: e.userId, tenantId: e.tenantId, category: 'learning', title: 'Your certificate is ready', body: `Congratulations on completing ${e.course.title}!`, link: '/learn/certificates', brand: tenant.name }).catch(() => undefined);
        return cert;
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
        const raced = await this.db.certificate.findFirst({ where: { enrollmentId } });
        if (raced) return raced;
      }
    }
    throw new Error('Could not allocate a certificate number');
  }

  verifyUrl(number: string) {
    return `${this.config.get('WEB_PUBLIC_URL')}/verify/${encodeURIComponent(number)}`;
  }

  async pdf(certificateId: string, userId?: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    const c = await this.db.certificate.findFirst({ where: { id: certificateId, ...(userId ? { userId } : {}) } });
    if (!c) throw AppException.notFound('Certificate not found');
    if (c.status === 'REVOKED') throw AppException.forbidden('This certificate has been revoked.');
    const t = await this.template();
    const doc = await PDFDocument.create();
    doc.setTitle(`${t.title} — ${c.recipientName}`);
    doc.setAuthor(c.academyName);
    const page = doc.addPage([842, 595]); // A4 landscape
    const { width, height } = page.getSize();
    const accent = hexToRgb(t.accentColor);
    const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
    const sans = await doc.embedFont(StandardFonts.Helvetica);
    const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const center = (text: string, y: number, size: number, font = sans, color = rgb(0.15, 0.18, 0.25)) => {
      const s = pdfSafe(text);
      page.drawText(s, { x: (width - font.widthOfTextAtSize(s, size)) / 2, y, size, font, color });
    };
    page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: accent, borderWidth: 3 });
    page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderColor: accent, borderWidth: 0.75, opacity: 0.6 });
    center(c.academyName.toUpperCase(), height - 100, 14, sansBold, accent);
    center(t.title, height - 160, 34, serif);
    center('This is to certify that', height - 210, 13);
    center(c.recipientName, height - 260, 30, serif, accent);
    center(t.bodyText, height - 300, 13);
    center(c.courseTitle, height - 335, 18, sansBold);
    center(`Issued on ${c.issuedAt.toISOString().slice(0, 10)}`, height - 370, 11);
    page.drawText(pdfSafe(`Certificate no. ${c.number}`), { x: 60, y: 60, size: 9, font: sans, color: rgb(0.4, 0.45, 0.5) });
    if (t.signatoryName) {
      page.drawLine({ start: { x: width - 290, y: 110 }, end: { x: width - 110, y: 110 }, thickness: 0.75, color: rgb(0.4, 0.45, 0.5) });
      page.drawText(pdfSafe(t.signatoryName), { x: width - 290, y: 94, size: 11, font: sansBold });
      if (t.signatoryRole) page.drawText(pdfSafe(t.signatoryRole), { x: width - 290, y: 80, size: 9, font: sans, color: rgb(0.4, 0.45, 0.5) });
    }
    if (t.showQr) {
      const png = await QRCode.toBuffer(this.verifyUrl(c.number), { margin: 1, width: 240 });
      const img = await doc.embedPng(png);
      page.drawImage(img, { x: 60, y: 80, width: 72, height: 72 });
      page.drawText('Scan to verify', { x: 62, y: 158, size: 8, font: sans, color: rgb(0.4, 0.45, 0.5) });
    }
    return { bytes: await doc.save(), fileName: `certificate-${c.number}.pdf` };
  }

  /** Public verification (no tenant context needed: numbers are globally unique). */
  async verify(number: string, meta: { ip?: string; userAgent?: string }) {
    const c = await this.prisma.certificate.findUnique({ where: { number } });
    if (!c) throw AppException.notFound('No certificate exists with this number.');
    await this.prisma.certificateVerification.create({
      data: { certificateId: c.id, ipHash: meta.ip ? createHash('sha256').update(meta.ip).digest('hex') : null, userAgent: meta.userAgent?.slice(0, 512) },
    });
    return { number: c.number, valid: c.status === 'ISSUED', status: c.status, recipientName: c.recipientName, courseTitle: c.courseTitle, academyName: c.academyName, issuedAt: c.issuedAt, revokedAt: c.revokedAt };
  }

  async listForStudent(userId: string) {
    return this.db.certificate.findMany({ where: { userId }, orderBy: { issuedAt: 'desc' } });
  }

  async listForCreator(q: { courseId?: string }) {
    return this.db.certificate.findMany({ where: q.courseId ? { courseId: q.courseId } : {}, orderBy: { issuedAt: 'desc' }, take: 500 });
  }

  async revoke(id: string, reason: string, actorUserId: string) {
    const c = await this.db.certificate.findFirst({ where: { id } });
    if (!c) throw AppException.notFound('Certificate not found');
    const updated = await this.db.certificate.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason } });
    await this.audit.record({ action: 'certificate.revoke', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Certificate', targetId: id, after: { reason } });
    return updated;
  }

  async reinstate(id: string, actorUserId: string) {
    const c = await this.db.certificate.findFirst({ where: { id } });
    if (!c) throw AppException.notFound('Certificate not found');
    const updated = await this.db.certificate.update({ where: { id }, data: { status: 'ISSUED', revokedAt: null, revokedReason: null } });
    await this.audit.record({ action: 'certificate.reinstate', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'Certificate', targetId: id });
    return updated;
  }
}
