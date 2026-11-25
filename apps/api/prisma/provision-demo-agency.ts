/**
 * One-shot provisioner for the TechX Courses demo agency on production.
 * Creates owner + students, Growth/Pro plan, custom domain, courses, coupons, community.
 *
 * Usage (on the VPS, from apps/api):
 *   node --env-file=/opt/lms/shared/.env --import tsx prisma/provision-demo-agency.ts
 */
import { randomBytes } from 'node:crypto';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import argon2 from 'argon2';
import Redis from 'ioredis';
import { TENANT_ROLES } from '@ce/shared';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { poolOptionsFromUrl } from '../src/core/prisma/prisma.service.js';

const AGENCY = {
  name: 'TechX Courses',
  slug: 'techx-courses',
  customDomain: 'courses.techxsolutions.io',
  tagline: 'Learn skills that get you hired',
  description:
    'TechX Courses is a demo academy built to show clients the full LMS experience — published courses, student learning, coupons, and a branded custom domain.',
  supportEmail: 'support@techxsolutions.io',
  primaryColor: '#0f766e',
  accentColor: '#f59e0b',
};

const OWNER = {
  email: 'demo.owner@techxsolutions.io',
  fullName: 'Priya Sharma',
  password: 'Demo@TechX2026!',
  phone: '+919876543210',
};

const STUDENTS = [
  { email: 'demo.student@techxsolutions.io', fullName: 'Aarav Mehta', password: 'Student@Demo1!' },
  { email: 'demo.learner@techxsolutions.io', fullName: 'Ananya Iyer', password: 'Student@Demo1!' },
];

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const hash = (password: string) =>
  argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const root = (process.env.PLATFORM_ROOT_DOMAIN || 'lms.techxsolutions.io').toLowerCase();
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(poolOptionsFromUrl(url)) });

  try {
    const existingDomain = await prisma.tenantDomain.findUnique({ where: { hostname: AGENCY.customDomain } });
    if (existingDomain) {
      const t = await prisma.tenant.findUnique({ where: { id: existingDomain.tenantId }, select: { id: true, name: true, slug: true, status: true } });
      console.log(JSON.stringify({ alreadyExists: true, tenant: t, domain: AGENCY.customDomain }, null, 2));
      return;
    }

    const plan =
      (await prisma.subscriptionPlan.findFirst({ where: { code: 'pro', status: 'ACTIVE' } })) ??
      (await prisma.subscriptionPlan.findFirst({ where: { code: 'growth', status: 'ACTIVE' } }));
    if (!plan) throw new Error('No Pro/Growth plan found — run platform seed first');

    const ownerRole = await prisma.role.findUniqueOrThrow({ where: { uniqueKey: `system:${TENANT_ROLES.OWNER}` } });
    const features = await prisma.planFeature.findMany({ where: { planId: plan.id } });
    const featureSnapshot = Object.fromEntries(
      features.map((f) => [f.featureKey, { enabled: f.enabled, limit: f.limitValue === null ? null : f.limitValue.toString() }]),
    );

    const ownerHash = await hash(OWNER.password);
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 12);

    const result = await prisma.$transaction(async (tx) => {
      let owner = await tx.user.findUnique({ where: { realmKey_email: { realmKey: 'platform', email: OWNER.email } } });
      if (!owner) {
        owner = await tx.user.create({
          data: {
            realm: 'PLATFORM',
            realmKey: 'platform',
            email: OWNER.email,
            fullName: OWNER.fullName,
            phone: OWNER.phone,
            country: 'IN',
            passwordHash: ownerHash,
            emailVerifiedAt: now,
            passwordChangedAt: now,
          },
        });
      } else {
        await tx.user.update({
          where: { id: owner.id },
          data: {
            passwordHash: ownerHash,
            passwordChangedAt: now,
            failedLoginCount: 0,
            lockedUntil: null,
            status: 'ACTIVE',
            emailVerifiedAt: owner.emailVerifiedAt ?? now,
          },
        });
      }

      const slugTaken = await tx.tenant.findUnique({ where: { slug: AGENCY.slug } });
      const slug = slugTaken ? `${AGENCY.slug}-${randomBytes(2).toString('hex')}` : AGENCY.slug;

      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: AGENCY.name,
          ownerUserId: owner.id,
          country: 'IN',
          defaultCurrency: 'INR',
          timezone: 'Asia/Kolkata',
          status: 'ACTIVE',
          onboardingStep: 10,
          onboardingCompletedAt: now,
        },
      });

      await tx.tenantMember.create({
        data: { tenantId: tenant.id, userId: owner.id, roleId: ownerRole.id, status: 'ACTIVE' },
      });

      await tx.tenantDomain.create({
        data: {
          tenantId: tenant.id,
          hostname: `${slug}.${root}`,
          type: 'SUBDOMAIN',
          isPrimary: false,
          status: 'VERIFIED',
          verificationToken: randomBytes(16).toString('hex'),
          verifiedAt: now,
        },
      });

      await tx.tenantDomain.create({
        data: {
          tenantId: tenant.id,
          hostname: AGENCY.customDomain,
          type: 'CUSTOM',
          isPrimary: true,
          status: 'VERIFIED',
          verificationToken: randomBytes(16).toString('hex'),
          verifiedAt: now,
        },
      });

      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'ACTIVE',
          currentKey: 'current',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          featureSnapshot: featureSnapshot as never,
          source: 'admin_demo',
        },
      });

      await tx.academy.create({
        data: {
          tenantId: tenant.id,
          tagline: AGENCY.tagline,
          description: AGENCY.description,
          supportEmail: AGENCY.supportEmail,
          primaryColor: AGENCY.primaryColor,
          accentColor: AGENCY.accentColor,
          fontHeading: 'Inter',
          fontBody: 'Inter',
          socialLinks: {
            website: `https://${AGENCY.customDomain}`,
            linkedin: 'https://www.linkedin.com/company/techxsolutions',
          } as never,
          publishedAt: now,
        },
      });

      await tx.tenantBusinessProfile.create({
        data: {
          tenantId: tenant.id,
          legalName: 'TechX Solutions LLP',
          addressLine1: '221 Business Park',
          city: 'Ahmedabad',
          state: 'Gujarat',
          postalCode: '380015',
          country: 'IN',
          gstRegistered: true,
          gstin: '24AABCT1332L1ZV',
          pan: 'AABCT1332L',
          taxRate: 18,
          pricesIncludeTax: true,
          invoicesEnabled: true,
          invoicePrefix: 'TXC',
        },
      });

      const coursesSpec = [
        {
          title: 'Full-Stack Web Development',
          slug: 'full-stack-web-development',
          shortDescription: 'Build production web apps with HTML, CSS, JavaScript and Node.js.',
          isFree: false,
          priceAmount: 4999,
          compareAtAmount: 7999,
          level: 'BEGINNER' as const,
          lessons: [
            { title: 'Welcome & course roadmap', body: 'What you will build and how this demo course is structured.' },
            { title: 'Modern JavaScript essentials', body: 'Variables, functions, async/await and modules used every day.' },
            { title: 'Building your first API', body: 'Create a small Express API and connect it to a frontend.' },
          ],
        },
        {
          title: 'Digital Marketing Fundamentals',
          slug: 'digital-marketing-fundamentals',
          shortDescription: 'SEO, ads, content and analytics for growing an online brand.',
          isFree: false,
          priceAmount: 2999,
          compareAtAmount: 4499,
          level: 'ALL_LEVELS' as const,
          lessons: [
            { title: 'Marketing funnel basics', body: 'Awareness, consideration and conversion — with academy examples.' },
            { title: 'Content that converts', body: 'Landing pages, hooks and CTAs that students respond to.' },
            { title: 'Measuring what matters', body: 'UTMs, dashboards and weekly review habits.' },
          ],
        },
        {
          title: 'Career Kickstart (Free Preview)',
          slug: 'career-kickstart',
          shortDescription: 'A free starter course so demos can show the student learning experience immediately.',
          isFree: true,
          priceAmount: null as number | null,
          compareAtAmount: null as number | null,
          level: 'BEGINNER' as const,
          lessons: [
            { title: 'How to use this academy', body: 'Browse courses, enrol, track progress and download certificates.' },
            { title: 'Setting learning goals', body: 'Pick one skill, schedule study time, and ship a small project.' },
            { title: 'Your first win checklist', body: 'Complete this free course, then unlock a paid track.' },
          ],
        },
      ];

      const createdCourses: { id: string; slug: string; title: string; isFree: boolean }[] = [];
      for (const spec of coursesSpec) {
        const course = await tx.course.create({
          data: {
            tenantId: tenant.id,
            title: spec.title,
            slug: spec.slug,
            shortDescription: spec.shortDescription,
            description: doc(spec.shortDescription) as never,
            createdById: owner.id,
            currency: 'INR',
            isFree: spec.isFree,
            priceAmount: spec.priceAmount,
            compareAtAmount: spec.compareAtAmount,
            level: spec.level,
            status: 'PUBLISHED',
            visibility: 'PUBLIC',
            publishedAt: now,
            certificateEnabled: true,
            tags: ['demo', 'techx'] as never,
            objectives: spec.lessons.map((l) => l.title) as never,
            seoTitle: spec.title.slice(0, 70),
            seoDescription: spec.shortDescription.slice(0, 170),
          },
        });
        await tx.courseInstructor.create({
          data: { tenantId: tenant.id, courseId: course.id, userId: owner.id, isPrimary: true },
        });
        const section = await tx.courseSection.create({
          data: { tenantId: tenant.id, courseId: course.id, title: 'Getting started', position: 0 },
        });
        let pos = 0;
        for (const lesson of spec.lessons) {
          await tx.courseLesson.create({
            data: {
              tenantId: tenant.id,
              courseId: course.id,
              sectionId: section.id,
              title: lesson.title,
              type: 'TEXT',
              position: pos++,
              content: doc(lesson.body) as never,
              isPublished: true,
              isFreePreview: pos === 1,
            },
          });
        }
        createdCourses.push({ id: course.id, slug: course.slug, title: course.title, isFree: course.isFree });
      }

      await tx.coupon.create({
        data: {
          tenantId: tenant.id,
          code: 'DEMO20',
          description: '20% off any paid course — for client demos',
          type: 'PERCENT',
          value: 20,
          maxDiscountAmount: 1500,
          showAtCheckout: true,
          isActive: true,
          createdById: owner.id,
          courseIds: createdCourses.filter((c) => !c.isFree).map((c) => c.id) as never,
        },
      });

      await tx.bundle.create({
        data: {
          tenantId: tenant.id,
          title: 'Career Accelerator Bundle',
          slug: 'career-accelerator-bundle',
          description: 'Full-Stack Web Development + Digital Marketing at a demo bundle price.',
          priceAmount: 6499,
          currency: 'INR',
          courseIds: createdCourses.filter((c) => !c.isFree).map((c) => c.id) as never,
          status: 'PUBLISHED',
          publishedAt: now,
          createdById: owner.id,
        },
      });

      const community = await tx.community.create({
        data: {
          tenantId: tenant.id,
          name: 'TechX Learners Lounge',
          description: 'Ask questions, share wins, and follow along with the demo cohort.',
          access: 'OPEN',
          status: 'ACTIVE',
          createdById: owner.id,
        },
      });
      await tx.communityPost.create({
        data: {
          tenantId: tenant.id,
          communityId: community.id,
          authorId: owner.id,
          authorRole: 'STAFF',
          title: 'Welcome to the demo academy',
          body: 'This community is pre-seeded so you can show discussion features during client demos. Feel free to post!',
          pinned: true,
          likes: [] as never,
        },
      });

      const studentsOut: { email: string; fullName: string; password: string }[] = [];
      for (const s of STUDENTS) {
        const passwordHash = await hash(s.password);
        let user = await tx.user.findUnique({
          where: { realmKey_email: { realmKey: tenant.id, email: s.email } },
        });
        if (!user) {
          user = await tx.user.create({
            data: {
              realm: 'TENANT',
              realmKey: tenant.id,
              tenantId: tenant.id,
              email: s.email,
              fullName: s.fullName,
              country: 'IN',
              passwordHash,
              emailVerifiedAt: now,
              passwordChangedAt: now,
            },
          });
        } else {
          await tx.user.update({
            where: { id: user.id },
            data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE' },
          });
        }
        const freeCourse = createdCourses.find((c) => c.isFree)!;
        await tx.enrollment.upsert({
          where: { tenantId_userId_courseId: { tenantId: tenant.id, userId: user.id, courseId: freeCourse.id } },
          create: {
            tenantId: tenant.id,
            userId: user.id,
            courseId: freeCourse.id,
            source: 'MANUAL',
            status: 'ACTIVE',
            progressPercent: 35,
            grantedById: owner.id,
          },
          update: { status: 'ACTIVE', progressPercent: 35 },
        });
        studentsOut.push({ email: s.email, fullName: s.fullName, password: s.password });
      }

      await tx.auditLog.create({
        data: {
          action: 'tenant.create_by_admin',
          tenantId: tenant.id,
          actorRealm: 'PLATFORM',
          targetType: 'Tenant',
          targetId: tenant.id,
          after: { name: tenant.name, slug: tenant.slug, demo: true, customDomain: AGENCY.customDomain } as never,
        },
      });

      return {
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status },
        plan: { id: plan.id, name: plan.name, code: plan.code },
        courses: createdCourses,
        owner: { email: OWNER.email, fullName: OWNER.fullName, password: OWNER.password },
        students: studentsOut,
      };
    });

    // Clear host-resolver cache so the new domain resolves immediately.
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const redis = new Redis(redisUrl);
      await redis.del(`host:${AGENCY.customDomain}`, `host:${result.tenant.slug}.${root}`);
      await redis.quit();
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          agency: result.tenant,
          plan: result.plan,
          urls: {
            studentPortal: `https://${AGENCY.customDomain}`,
            platformSubdomain: `https://${result.tenant.slug}.${root}`,
            ownerLogin: `https://${AGENCY.customDomain}/login`,
            studentLogin: `https://${AGENCY.customDomain}/login`,
          },
          access: {
            owner: result.owner,
            students: result.students,
            coupon: 'DEMO20',
          },
          courses: result.courses,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
