/**
 * Idempotent demo enrichment for TechX Courses (courses.techxsolutions.io).
 * PATH=/opt/node24/bin:$PATH node --env-file=/opt/lms/shared/.env --import tsx prisma/enrich-demo-agency.ts
 */
import { randomBytes } from 'node:crypto';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import Redis from 'ioredis';
import { Prisma } from '../src/generated/prisma/client.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { poolOptionsFromUrl } from '../src/core/prisma/prisma.service.js';
import { TEMPLATES } from '../src/modules/website/templates.js';

const CUSTOM_DOMAIN = 'courses.techxsolutions.io';
const MARKER_KEY = 'demo.enrich.full_v1';
const STUDENT_EMAILS = ['demo.student@techxsolutions.io', 'demo.learner@techxsolutions.io'];

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const richDoc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

async function nextSequence(tx: Prisma.TransactionClient, tenantId: string, name: string): Promise<number> {
  await tx.$executeRaw`INSERT INTO TenantSequence (tenantId, name, value) VALUES (${tenantId}, ${name}, 1) ON DUPLICATE KEY UPDATE value = value + 1`;
  const rows: { value: number }[] = await tx.$queryRaw`SELECT value FROM TenantSequence WHERE tenantId = ${tenantId} AND name = ${name}`;
  return rows[0]!.value;
}

type LessonSpec =
  | { title: string; type: 'TEXT'; body: string; freePreview?: boolean }
  | { title: string; type: 'LINK'; body: string; url: string; freePreview?: boolean }
  | { title: string; type: 'QUIZ'; body: string };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const root = (process.env.PLATFORM_ROOT_DOMAIN || 'lms.techxsolutions.io').toLowerCase();
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(poolOptionsFromUrl(url)) });
  const added: string[] = [];

  try {
    const domain = await prisma.tenantDomain.findUnique({ where: { hostname: CUSTOM_DOMAIN } });
    if (!domain) throw new Error(`No tenant for ${CUSTOM_DOMAIN}`);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: domain.tenantId }, include: { academy: true } });
    const tenantId = tenant.id;
    const ownerId = tenant.ownerUserId;
    const academy = tenant.academy!;
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86_400_000);
    const in7 = new Date(now.getTime() + 7 * 86_400_000);

    const students = await Promise.all(STUDENT_EMAILS.map((email) => prisma.user.findFirst({ where: { tenantId, email, realm: 'TENANT' } })));
    if (students.some((s) => !s)) throw new Error('Demo students missing');
    const student1 = students[0]!;
    const student2 = students[1]!;

    const upsertCategory = async (name: string, slug: string, sortOrder: number) => {
      const existing = await prisma.courseCategory.findFirst({ where: { scopeKey: tenantId, slug } });
      return existing ?? prisma.courseCategory.create({ data: { tenantId, scopeKey: tenantId, name, slug, sortOrder } });
    };

    const catTech = await upsertCategory('Technology', 'technology', 0);
    await upsertCategory('Business & Marketing', 'business-marketing', 1);
    await upsertCategory('Career Growth', 'career-growth', 2);
    added.push('course_categories');

    await prisma.certificateTemplate.upsert({
      where: { tenantId },
      create: { tenantId, title: 'Certificate of Achievement', bodyText: 'has successfully completed the course requirements for', signatoryName: 'Priya Sharma', signatoryRole: 'Academy Director', accentColor: academy.primaryColor },
      update: { signatoryName: 'Priya Sharma', signatoryRole: 'Academy Director', accentColor: academy.primaryColor },
    });
    added.push('certificate_template');

    const extraCourses = [
      { title: 'UI/UX Design for Creators', slug: 'ui-ux-design-creators', shortDescription: 'Design landing pages and course thumbnails that convert.', isFree: false, priceAmount: 3499, compareAtAmount: 4999, level: 'INTERMEDIATE' as const, categorySlug: catTech.slug, sections: [{ title: 'Design foundations', lessons: [{ title: 'Visual hierarchy for learning apps', type: 'TEXT' as const, body: 'Typography and spacing for education products.', freePreview: true }, { title: 'Figma walkthrough', type: 'LINK' as const, body: 'Community UI inspiration.', url: 'https://www.figma.com/community' }] }, { title: 'Course assets', lessons: [{ title: 'Thumbnail checklist', type: 'TEXT' as const, body: 'Contrast and readable titles on mobile.' }, { title: 'Prototype review quiz', type: 'QUIZ' as const, body: '' }] }] },
      { title: 'Data Analytics with Python', slug: 'data-analytics-python', shortDescription: 'Pandas, charts and storytelling with datasets.', isFree: false, priceAmount: 5999, compareAtAmount: 8999, level: 'INTERMEDIATE' as const, categorySlug: catTech.slug, sections: [{ title: 'Python data stack', lessons: [{ title: 'Notebook setup', type: 'TEXT' as const, body: 'Virtualenv and Jupyter.', freePreview: true }, { title: 'Pandas crash course', type: 'LINK' as const, body: 'Official guide.', url: 'https://pandas.pydata.org/docs/getting_started/index.html' }, { title: 'Plotting trends', type: 'TEXT' as const, body: 'Charts for executives.' }] }] },
      { title: 'Interview Confidence Workshop', slug: 'interview-confidence', shortDescription: 'STAR stories and mock prompts.', isFree: false, priceAmount: 1999, compareAtAmount: 2999, level: 'ALL_LEVELS' as const, categorySlug: 'career-growth', sections: [{ title: 'Before the call', lessons: [{ title: 'Your 60-second pitch', type: 'TEXT' as const, body: 'Role, proof, outcome.', freePreview: true }, { title: 'Common HR questions', type: 'TEXT' as const, body: 'Gaps and relocation.' }] }] },
    ];

    for (const spec of extraCourses) {
      let course = await prisma.course.findFirst({ where: { tenantId, slug: spec.slug } });
      if (!course) {
        course = await prisma.course.create({
          data: { tenantId, title: spec.title, slug: spec.slug, shortDescription: spec.shortDescription, description: richDoc(spec.shortDescription) as never, createdById: ownerId, currency: 'INR', isFree: spec.isFree, priceAmount: spec.priceAmount, compareAtAmount: spec.compareAtAmount, level: spec.level, categorySlug: spec.categorySlug, status: 'PUBLISHED', visibility: 'PUBLIC', publishedAt: now, certificateEnabled: true, tags: ['demo', 'techx'] as never, durationMinutes: 180 },
        });
        await prisma.courseInstructor.create({ data: { tenantId, courseId: course.id, userId: ownerId, isPrimary: true } });
        added.push(`course:${spec.slug}`);
      }
      let sectionPos = await prisma.courseSection.count({ where: { tenantId, courseId: course.id } });
      for (const sec of spec.sections) {
        let section = await prisma.courseSection.findFirst({ where: { tenantId, courseId: course.id, title: sec.title } });
        if (!section) section = await prisma.courseSection.create({ data: { tenantId, courseId: course.id, title: sec.title, position: sectionPos++ } });
        let lessonPos = await prisma.courseLesson.count({ where: { tenantId, sectionId: section.id } });
        for (const lesson of sec.lessons as LessonSpec[]) {
          if (await prisma.courseLesson.findFirst({ where: { tenantId, sectionId: section.id, title: lesson.title } })) continue;
          const created = await prisma.courseLesson.create({
            data: { tenantId, courseId: course.id, sectionId: section.id, title: lesson.title, type: lesson.type, position: lessonPos++, content: lesson.body ? (doc(lesson.body) as never) : Prisma.DbNull, externalUrl: lesson.type === 'LINK' ? lesson.url : null, isPublished: true, isFreePreview: lesson.type !== 'QUIZ' && Boolean(lesson.freePreview), durationSeconds: lesson.type === 'LINK' ? 600 : undefined },
          });
          if (lesson.type === 'QUIZ') {
            const quiz = await prisma.quiz.create({ data: { tenantId, courseId: course.id, lessonId: created.id, passPercent: 50 } });
            const q1 = await prisma.quizQuestion.create({ data: { tenantId, quizId: quiz.id, type: 'MCQ_SINGLE', prompt: 'Recommended body-text contrast?', position: 0, points: 1 } });
            await prisma.quizOption.createMany({ data: [{ tenantId, questionId: q1.id, label: '4.5:1', isCorrect: true, position: 0 }, { tenantId, questionId: q1.id, label: '2:1', isCorrect: false, position: 1 }] });
          }
        }
      }
    }

    const flagship = await prisma.course.findFirst({ where: { tenantId, slug: 'full-stack-web-development' } });
    if (flagship && !(await prisma.courseSection.findFirst({ where: { tenantId, courseId: flagship.id, title: 'Bonus: deployment & demos' } }))) {
      const bonus = await prisma.courseSection.create({ data: { tenantId, courseId: flagship.id, title: 'Bonus: deployment & demos', position: 10 } });
      await prisma.courseLesson.create({ data: { tenantId, courseId: flagship.id, sectionId: bonus.id, title: 'Deploying to a VPS', type: 'TEXT', position: 0, content: doc('PM2 and Nginx demo talking points.') as never, isPublished: true } });
      await prisma.courseLesson.create({ data: { tenantId, courseId: flagship.id, sectionId: bonus.id, title: 'Sample screencast', type: 'LINK', position: 1, externalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', content: doc('LINK lesson when Bunny is not configured.') as never, isPublished: true, durationSeconds: 212 } });
      added.push('course:full-stack-bonus');
    }

    const allPaid = await prisma.course.findMany({ where: { tenantId, isFree: false, status: 'PUBLISHED' }, select: { id: true } });
    const allCourses = await prisma.course.findMany({ where: { tenantId, status: 'PUBLISHED' }, select: { id: true } });
    const dmCourse = await prisma.course.findFirst({ where: { tenantId, slug: 'digital-marketing-fundamentals' } });

    if (!(await prisma.coupon.findFirst({ where: { tenantId, code: 'WELCOME50' } }))) {
      await prisma.coupon.create({ data: { tenantId, code: 'WELCOME50', description: '₹500 off demo', type: 'FIXED', value: 500, minOrderAmount: 1500, showAtCheckout: true, isActive: true, createdById: ownerId, courseIds: allPaid.map((c) => c.id) as never } });
      added.push('coupon:WELCOME50');
    }
    if (!(await prisma.digitalProduct.findFirst({ where: { tenantId, slug: 'interview-prep-kit' } }))) {
      await prisma.digitalProduct.create({ data: { tenantId, title: 'Interview Prep Kit', slug: 'interview-prep-kit', description: 'Worksheets for demo downloads.', priceAmount: 499, compareAtAmount: 999, currency: 'INR', status: 'PUBLISHED', publishedAt: now, createdById: ownerId } });
      added.push('digital_product');
    }
    if (!(await prisma.bundle.findFirst({ where: { tenantId, slug: 'complete-career-pack' } }))) {
      await prisma.bundle.create({ data: { tenantId, title: 'Complete Career Pack', slug: 'complete-career-pack', description: 'Bundle for demos.', priceAmount: 9999, currency: 'INR', courseIds: allPaid.slice(0, 3).map((c) => c.id) as never, status: 'PUBLISHED', publishedAt: now, createdById: ownerId } });
      added.push('bundle:complete-career-pack');
    }
    const bumpTarget = await prisma.course.findFirst({ where: { tenantId, slug: 'interview-confidence' } });
    if (bumpTarget && !(await prisma.salesOffer.findFirst({ where: { tenantId, name: 'Demo order bump' } }))) {
      await prisma.salesOffer.create({ data: { tenantId, type: 'BUMP', status: 'ACTIVE', name: 'Demo order bump', headline: 'Add Interview Confidence', itemKind: 'course', itemId: bumpTarget.id, priceAmount: 999, currency: 'INR', triggers: allPaid.map((c) => `course:${c.id}`) as never, createdById: ownerId } });
      added.push('sales_offer');
    }
    if (dmCourse && !(await prisma.paymentLink.findFirst({ where: { tenantId, code: 'DEMOLINK' } }))) {
      await prisma.paymentLink.create({ data: { tenantId, code: 'DEMOLINK', title: 'Digital Marketing partner price', itemKind: 'course', itemId: dmCourse.id, priceAmount: 2499, currency: 'INR', couponCode: 'DEMO20', allowCoupons: true, createdById: ownerId } });
      added.push('payment_link');
    }
    if (!(await prisma.membershipPlan.findFirst({ where: { tenantId, name: 'All-Access Monthly' } }))) {
      const plan = await prisma.membershipPlan.create({ data: { tenantId, name: 'All-Access Monthly', description: 'All courses.', priceAmount: 1499, compareAtAmount: 2499, currency: 'INR', interval: 'MONTH', courseIds: allCourses.map((c) => c.id) as never, status: 'ACTIVE', createdById: ownerId, faqs: [] as never } });
      await prisma.membership.create({ data: { tenantId, userId: student2.id, planId: plan.id, status: 'ACTIVE', startedAt: now, currentPeriodEnd: in30 } });
      added.push('membership');
    }
    await prisma.affiliateProgram.upsert({ where: { tenantId }, create: { tenantId, enabled: true, defaultPercent: 15, cookieDays: 30, holdDays: 7, autoApprove: true }, update: { enabled: true } });
    if (!(await prisma.affiliate.findFirst({ where: { tenantId, code: 'DEMOPARTNER' } }))) {
      const aff = await prisma.affiliate.create({ data: { tenantId, userId: student1.id, code: 'DEMOPARTNER', commissionPercent: 15, status: 'ACTIVE', approvedAt: now } });
      await prisma.affiliateClick.create({ data: { tenantId, affiliateId: aff.id, path: '/courses' } });
      added.push('affiliate');
    }

    const community = await prisma.community.findFirst({ where: { tenantId, name: 'TechX Learners Lounge' } });
    if (community) {
      const welcome = await prisma.communityPost.findFirst({ where: { tenantId, communityId: community.id, pinned: true } });
      if (welcome && !(await prisma.communityComment.findFirst({ where: { tenantId, postId: welcome.id } }))) {
        await prisma.communityComment.create({ data: { tenantId, postId: welcome.id, authorId: student1.id, authorRole: 'MEMBER', body: 'Great demo setup!' } });
      }
      if (!(await prisma.communityPost.findFirst({ where: { tenantId, communityId: community.id, title: 'Weekly wins thread' } }))) {
        await prisma.communityPost.create({ data: { tenantId, communityId: community.id, authorId: ownerId, authorRole: 'STAFF', title: 'Weekly wins thread', body: 'Share your wins.', likes: [] as never } });
        added.push('community_posts');
      }
    }

    if (flagship && !(await prisma.batch.findFirst({ where: { tenantId, name: 'January Demo Cohort' } }))) {
      const batch = await prisma.batch.create({ data: { tenantId, name: 'January Demo Cohort', courseId: flagship.id, startsAt: now, endsAt: in30, createdById: ownerId } });
      await prisma.batchMember.createMany({ data: [{ tenantId, batchId: batch.id, userId: student1.id }, { tenantId, batchId: batch.id, userId: student2.id }] });
      added.push('batch');
    }
    if (!(await prisma.liveClass.findFirst({ where: { tenantId, slug: 'demo-career-ama' } }))) {
      const lc = await prisma.liveClass.create({ data: { tenantId, kind: 'WEBINAR', title: 'Career AMA', slug: 'demo-career-ama', provider: 'EXTERNAL', externalUrl: 'https://meet.google.com/lookup/demo-techx', audience: 'ALL_STUDENTS', hostUserId: ownerId, durationMinutes: 60, timezone: 'Asia/Kolkata', priceAmount: 499, currency: 'INR', status: 'ACTIVE', createdById: ownerId } });
      await prisma.liveSession.create({ data: { tenantId, liveClassId: lc.id, startsAt: in7, endsAt: new Date(in7.getTime() + 3_600_000), status: 'SCHEDULED', roomName: `demo-${randomBytes(8).toString('hex')}`, providerJoinUrl: 'https://meet.google.com/lookup/demo-techx' } });
      added.push('live_webinar');
    }
    if (!(await prisma.coachingProgram.findFirst({ where: { tenantId, slug: 'demo-coaching' } }))) {
      const prog = await prisma.coachingProgram.create({ data: { tenantId, title: '1:1 Career Strategy', slug: 'demo-coaching', description: doc('Coaching menu demo.') as never, priceAmount: 4999, currency: 'INR', status: 'PUBLISHED', publishedAt: now, faqs: [] as never, createdById: ownerId } });
      await prisma.coachingCoach.create({ data: { tenantId, programId: prog.id, userId: ownerId, weight: 1 } });
      added.push('coaching');
    }

    const freeCourse = await prisma.course.findFirst({ where: { tenantId, slug: 'career-kickstart' } });
    if (freeCourse) {
      const enr = await prisma.enrollment.upsert({ where: { tenantId_userId_courseId: { tenantId, userId: student1.id, courseId: freeCourse.id } }, create: { tenantId, userId: student1.id, courseId: freeCourse.id, source: 'FREE', status: 'ACTIVE', progressPercent: 66, grantedById: ownerId }, update: { progressPercent: 66 } });
      for (const lesson of await prisma.courseLesson.findMany({ where: { tenantId, courseId: freeCourse.id }, orderBy: { position: 'asc' }, take: 2 })) {
        await prisma.lessonProgress.upsert({ where: { tenantId_enrollmentId_lessonId: { tenantId, enrollmentId: enr.id, lessonId: lesson.id } }, create: { tenantId, enrollmentId: enr.id, lessonId: lesson.id, completedAt: now }, update: { completedAt: now } });
      }
    }
    if (dmCourse) await prisma.enrollment.upsert({ where: { tenantId_userId_courseId: { tenantId, userId: student2.id, courseId: dmCourse.id } }, create: { tenantId, userId: student2.id, courseId: dmCourse.id, source: 'MANUAL', status: 'ACTIVE', progressPercent: 40, grantedById: ownerId }, update: { progressPercent: 40 } });
    if (flagship) await prisma.enrollment.upsert({ where: { tenantId_userId_courseId: { tenantId, userId: student1.id, courseId: flagship.id } }, create: { tenantId, userId: student1.id, courseId: flagship.id, source: 'PURCHASE', status: 'ACTIVE', progressPercent: 25 }, update: { progressPercent: 25 } });

    if (flagship && !(await prisma.order.findFirst({ where: { tenantId, externalReference: 'DEMO-UPI-2026-001' } }))) {
      await prisma.$transaction(async (tx) => {
        const n = await nextSequence(tx, tenantId, 'order');
        const order = await tx.order.create({ data: { tenantId, number: `ORD-${String(n).padStart(6, '0')}`, userId: student1.id, status: 'PAID', currency: 'INR', subtotalAmount: 4999, discountAmount: 0, taxAmount: 0, totalAmount: 4999, taxRate: 18, taxInclusive: true, paymentMode: 'UPI', externalReference: 'DEMO-UPI-2026-001', recordedById: ownerId, paidAt: now, billing: { name: student1.fullName, email: student1.email, country: 'IN' } as never, expiresAt: in30 } });
        await tx.orderItem.create({ data: { tenantId, orderId: order.id, courseId: flagship.id, grantCourseIds: [flagship.id] as never, title: flagship.title.slice(0, 200), unitAmount: 4999, discountAmount: 0, totalAmount: 4999 } });
        await tx.ledgerEntry.create({ data: { tenantId, orderId: order.id, type: 'SALE', amount: 4999, currency: 'INR', description: `Order ${order.number}` } });
      });
      added.push('order');
    }

    for (const row of [{ course: dmCourse, user: student2, rating: 5, body: 'Clear and practical.' }, { course: flagship, user: student1, rating: 4, body: 'Loved the bonus module.' }]) {
      if (!row.course) continue;
      await prisma.courseReview.upsert({ where: { tenantId_courseId_userId: { tenantId, courseId: row.course.id, userId: row.user.id } }, create: { tenantId, courseId: row.course.id, userId: row.user.id, rating: row.rating, body: row.body, status: 'PUBLISHED', reply: 'Thank you!', repliedAt: now, repliedById: ownerId }, update: { rating: row.rating, body: row.body } });
    }
    if (flagship) {
      const lesson = await prisma.courseLesson.findFirst({ where: { tenantId, courseId: flagship.id, title: 'Welcome & course roadmap' } });
      if (lesson && !(await prisma.lessonComment.findFirst({ where: { tenantId, lessonId: lesson.id, authorId: student1.id } }))) {
        const root = await prisma.lessonComment.create({ data: { tenantId, courseId: flagship.id, lessonId: lesson.id, authorId: student1.id, authorRealm: 'TENANT', body: 'Starter template?' } });
        await prisma.lessonComment.create({ data: { tenantId, courseId: flagship.id, lessonId: lesson.id, authorId: ownerId, authorRealm: 'PLATFORM', parentId: root.id, body: 'See Bonus section.', isInstructor: true, isResolved: true } });
        added.push('lesson_qna');
      }
    }
    if (!(await prisma.supportTicket.findFirst({ where: { tenantId, scope: 'ACADEMY', subject: 'Cannot find certificate' } }))) {
      const ticket = await prisma.supportTicket.create({ data: { scope: 'ACADEMY', tenantId, requesterId: student1.id, assigneeId: ownerId, category: 'learning', priority: 'MEDIUM', status: 'PENDING', subject: 'Cannot find certificate', firstResponseAt: now } });
      await prisma.supportMessage.createMany({ data: [{ ticketId: ticket.id, authorId: student1.id, body: 'Where is my certificate?', isStaff: false }, { ticketId: ticket.id, authorId: ownerId, body: 'Unlocks at 100%.', isStaff: true }] });
      added.push('support_ticket');
    }
    if (!(await prisma.chatConversation.findFirst({ where: { tenantId, threadKey: `ACADEMY:${student1.id}` } }))) {
      const conv = await prisma.chatConversation.create({ data: { tenantId, kind: 'ACADEMY', customerUserId: student1.id, threadKey: `ACADEMY:${student1.id}`, status: 'OPEN', lastMessageAt: now, lastMessagePreview: 'EMI on bundle?' } });
      await prisma.chatMessage.createMany({ data: [{ tenantId, conversationId: conv.id, senderId: student1.id, side: 'customer', body: 'EMI on bundle?' }, { tenantId, conversationId: conv.id, senderId: ownerId, side: 'agent', body: 'Offline UPI enabled in demo.' }] });
      added.push('chat');
    }

    const templateInput = { name: tenant.name, tagline: academy.tagline, description: academy.description, supportEmail: academy.supportEmail };
    if (!(await prisma.siteSettings.findFirst({ where: { tenantId } }))) {
      await prisma.siteSettings.create({ data: { tenantId, mode: 'PLATFORM', template: 'classic', header: { showCoursesLink: true, showBlogLink: true, links: [{ label: 'About', href: '/p/about' }] } as never, footer: { text: '© TechX Courses', links: [] } as never } });
      added.push('site_settings');
    }
    for (const page of TEMPLATES.classic.pages(templateInput)) {
      const slug = page.isHome ? 'home' : page.slug;
      if (await prisma.sitePage.findFirst({ where: { tenantId, slug } })) continue;
      const blocks = page.blocks as never;
      await prisma.sitePage.create({ data: { tenantId, slug, title: page.title, isHome: Boolean(page.isHome), showInNav: page.showInNav ?? true, navOrder: 0, draftBlocks: blocks, publishedBlocks: blocks, publishedTitle: page.title, publishedAt: now, createdById: ownerId } });
      added.push(`site:${slug}`);
    }
    for (const post of [{ slug: 'five-skills-2026', title: 'Five skills for 2026', excerpt: 'Demo blog.' }, { slug: 'live-cohort-tips', title: 'Live cohort tips', excerpt: 'Batches demo.' }]) {
      if (await prisma.blogPost.findFirst({ where: { tenantId, slug: post.slug } })) continue;
      await prisma.blogPost.create({ data: { tenantId, slug: post.slug, title: post.title, excerpt: post.excerpt, content: richDoc(post.excerpt) as never, status: 'PUBLISHED', publishedAt: now, authorId: ownerId } });
      added.push(`blog:${post.slug}`);
    }
    if (!(await prisma.analyticsEvent.findFirst({ where: { tenantId, utmCampaign: 'demo-walkthrough' } }))) {
      await prisma.analyticsEvent.createMany({ data: [{ tenantId, type: 'page_view', path: '/', itemType: 'home', visitorId: randomBytes(8).toString('hex'), utmSource: 'demo', utmMedium: 'sales', utmCampaign: 'demo-walkthrough' }] });
      added.push('analytics');
    }

    await prisma.tenantSetting.upsert({ where: { tenantId_key: { tenantId, key: MARKER_KEY } }, create: { tenantId, key: MARKER_KEY, value: { at: now.toISOString() } as never }, update: { value: { lastRun: now.toISOString() } as never } });
    await prisma.auditLog.create({ data: { action: 'demo.enrich_agency', tenantId, actorRealm: 'PLATFORM', targetType: 'Tenant', targetId: tenantId, after: { added } as never } });

    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const redis = new Redis(redisUrl);
      await redis.del(`host:${CUSTOM_DOMAIN}`, `host:${tenant.slug}.${root}`);
      await redis.quit();
    }

    console.log(JSON.stringify({ ok: true, tenantId, slug: tenant.slug, courseCount: await prisma.course.count({ where: { tenantId, status: 'PUBLISHED' } }), added, urls: { site: `https://${CUSTOM_DOMAIN}`, publicSiteApi: `https://${CUSTOM_DOMAIN}/api/v1/public/site`, coursesApi: `https://${CUSTOM_DOMAIN}/api/v1/public/courses` } }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});