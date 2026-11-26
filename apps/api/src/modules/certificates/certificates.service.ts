import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { CERTIFICATE_DESIGN_KEYS, resolveCertificateDesign } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { renderCertificatePdf } from './certificate-pdf.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/** Unguessable, human-readable certificate number, e.g. CE-2026-7F3K9Q2M. */
export function certificateNumber(year = new Date().getUTCFullYear()): string {
  const bytes = randomBytes(8);
  return `CE-${year}-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

export type CertificateTemplateUpdate = {
  designKey?: string;
  title?: string;
  bodyText?: string;
  signatoryName?: string | null;
  signatoryRole?: string | null;
  accentColor?: string;
  showQr?: boolean;
};

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

  /** Catalog for the creator template chooser. */
  designs() {
    return CERTIFICATE_DESIGN_KEYS.map((key) => resolveCertificateDesign(key));
  }

  async updateTemplate(data: CertificateTemplateUpdate, actorUserId: string) {
    const t = await this.template();
    const patch: CertificateTemplateUpdate = { ...data };
    if (patch.designKey != null) patch.designKey = resolveCertificateDesign(patch.designKey).key;
    const updated = await this.db.certificateTemplate.update({ where: { id: t.id }, data: patch });
    await this.audit.record({ action: 'certificate.template_update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'CertificateTemplate', targetId: t.id, after: patch });
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
    return renderCertificatePdf({
      designKey: t.designKey,
      title: t.title,
      bodyText: t.bodyText,
      signatoryName: t.signatoryName,
      signatoryRole: t.signatoryRole,
      accentColor: t.accentColor,
      showQr: t.showQr,
      academyName: c.academyName,
      recipientName: c.recipientName,
      courseTitle: c.courseTitle,
      number: c.number,
      issuedAt: c.issuedAt,
      verifyUrl: this.verifyUrl(c.number),
    });
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
