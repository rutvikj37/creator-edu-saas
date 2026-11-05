import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContext } from './tenant-context.service.js';

/**
 * Models owned by a tenant. Every query on these models made through the tenant client is
 * automatically constrained to the current tenant. New tenant-owned models MUST be added here
 * (a unit test asserts every model with a required `tenantId` column is listed).
 */
export const TENANT_MODELS = new Set<string>(['TenantMember', 'TenantSetting', 'TenantDomain', 'Subscription', 'TenantLimitOverride', 'UsageRecord',
  'Academy', 'TenantBusinessProfile', 'FileAsset', 'Course', 'CourseInstructor', 'CourseSection', 'CourseLesson', 'StaffInvitation',
  'Enrollment', 'LessonProgress', 'LessonNote', 'CourseBookmark', 'LessonComment', 'Quiz', 'QuizQuestion', 'QuizOption', 'QuizAttempt', 'QuizAnswer',
  'Assignment', 'AssignmentSubmission', 'CertificateTemplate', 'Certificate',
  'VideoAsset', 'VideoPlaybackSession', 'VideoStatusHistory', 'VideoUploadSession', 'VideoProcessingEvent', 'VideoBackup', 'DocumentBackup', 'VideoUsageRecord',
  'AiRequest', 'PaymentGatewayAccount', 'Coupon', 'CouponRedemption', 'Order', 'OrderItem', 'Payment', 'Refund', 'LedgerEntry', 'Invoice', 'TenantSequence',
  'BillingInvoice', 'BillingPayment',
  'SiteSettings', 'SitePage', 'SitePageVersion', 'BlogPost',
  'Lead', 'ConsentEvent', 'Campaign', 'CampaignRecipient', 'Automation', 'AutomationRun',
  'AffiliateProgram', 'Affiliate', 'AffiliateClick', 'AffiliateConversion',
  'Community', 'CommunityPost', 'CommunityComment', 'CommunityReport', 'MembershipPlan', 'Membership',
  'Batch', 'BatchMember', 'LiveClass', 'LiveSession', 'LiveAttendance', 'LiveAdmission', 'LivePoll', 'LivePollVote', 'LiveQuestion', 'WebinarRegistration',
]);

export class TenantContextMissingError extends Error {
  constructor(model: string, operation: string) {
    super(`Tenant context missing for ${model}.${operation}. Use TenantContext.run() or runAsPlatform().`);
    this.name = 'TenantContextMissingError';
  }
}

const WHERE_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany',
]);

/** Returns args with tenant scoping applied. Exported for unit testing. */
export function scopeArgs(operation: string, args: any, tenantId: string): any {
  const a = { ...(args ?? {}) };
  if (WHERE_OPS.has(operation)) {
    a.where = { ...(a.where ?? {}), tenantId };
  }
  if (operation === 'create') a.data = { ...a.data, tenantId };
  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((d: object) => ({ ...d, tenantId }));
  }
  if (operation === 'upsert') {
    a.where = { ...a.where, tenantId };
    a.create = { ...a.create, tenantId };
  }
  // Never allow moving a row to another tenant.
  if ((operation === 'update' || operation === 'updateMany' || operation === 'upsert') && a.data?.tenantId && a.data.tenantId !== tenantId) {
    throw new Error('Changing tenantId is not allowed');
  }
  if (operation === 'upsert' && a.update?.tenantId && a.update.tenantId !== tenantId) throw new Error('Changing tenantId is not allowed');
  return a;
}

export function createTenantPrisma(prisma: PrismaService, ctx: TenantContext) {
  return prisma.$extends(
    Prisma.defineExtension({
      name: 'tenant-scope',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!TENANT_MODELS.has(model)) return query(args);
            if (ctx.bypass) return query(args);
            const tenantId = ctx.tenantId;
            if (!tenantId) throw new TenantContextMissingError(model, operation);
            return query(scopeArgs(operation, args, tenantId));
          },
        },
      },
    }),
  );
}

export type TenantPrismaClient = ReturnType<typeof createTenantPrisma>;
