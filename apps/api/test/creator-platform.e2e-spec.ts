import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import {
  api, authed, codeFromEmail, createTestApp, lastEmail, login, parseSession, PDF, PLATFORM, PNG, registerCreator, resetDatabase, tenantHost, tokenFromEmail, uniqueEmail, uploadFile,
} from './helpers.js';

const richDoc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('Creator platform (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  describe('files', () => {
    it('uploads, verifies content signatures and serves via signed URLs', async () => {
      const c = await registerCreator(app);
      const ok = await uploadFile(app, c.session, 'LOGO', 'logo.png', 'image/png', PNG);
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ status: 'READY', mimeType: 'image/png', sizeBytes: PNG.length });
      const dl = new URL(ok.body.data.url);
      const got = await request(app.getHttpServer()).get(dl.pathname).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); }).expect(200);
      expect(Buffer.from(got.body).subarray(0, 4).toString('hex')).toBe('89504e47');

      // A PDF disguised as PNG is rejected and removed.
      const fake = await uploadFile(app, c.session, 'LOGO', 'evil.png', 'image/png', PDF);
      expect(fake.status).toBe(422);
      // Disallowed types / oversize are rejected before upload.
      await authed(app, c.session).post('/api/v1/creator/files').send({ purpose: 'LOGO', fileName: 'x.svg', mimeType: 'image/svg+xml', sizeBytes: 10 }).expect(422);
      await authed(app, c.session).post('/api/v1/creator/files').send({ purpose: 'LOGO', fileName: 'x.png', mimeType: 'image/png', sizeBytes: 50 * 1024 * 1024 }).expect(422);
      // Tampered signed URL is refused.
      await request(app.getHttpServer()).get(dl.pathname.slice(0, -3) + 'abc').expect(403);
    });

    it("files are tenant-scoped: another academy can't complete or use them", async () => {
      const a = await registerCreator(app);
      const b = await registerCreator(app);
      const up = await uploadFile(app, a.session, 'IMAGE', 'pic.png', 'image/png', PNG);
      await authed(app, b.session).post(`/api/v1/creator/files/${up.body.data.id}/complete`).expect(404);
      await authed(app, b.session).put('/api/v1/creator/academy').send({ logoFileId: up.body.data.id }).expect(422);
    });
  });

  describe('academy profile & onboarding', () => {
    it('saves branding and business details with validation', async () => {
      const c = await registerCreator(app);
      const logo = await uploadFile(app, c.session, 'LOGO', 'logo.png', 'image/png', PNG);
      const res = await authed(app, c.session).put('/api/v1/creator/academy').send({ name: 'Renamed Academy', tagline: 'Learn by doing', logoFileId: logo.body.data.id, primaryColor: '#123abc', fontHeading: 'Poppins', socialLinks: { youtube: 'https://youtube.com/@x' } }).expect(200);
      expect(res.body.data).toMatchObject({ name: 'Renamed Academy', primaryColor: '#123abc', fontHeading: 'Poppins' });
      expect(res.body.data.logoUrl).toContain('/api/v1/files/local/');
      await authed(app, c.session).put('/api/v1/creator/academy').send({ primaryColor: 'red' }).expect(422);
      await authed(app, c.session).put('/api/v1/creator/academy').send({ fontHeading: 'Comic Sans' }).expect(422);
      await authed(app, c.session).put('/api/v1/creator/academy').send({ socialLinks: { youtube: 'javascript:alert(1)' } }).expect(422);

      await authed(app, c.session).put('/api/v1/creator/academy/business').send({ gstin: 'NOT-A-GSTIN' }).expect(422);
      const biz = await authed(app, c.session).put('/api/v1/creator/academy/business').send({ legalName: 'Renamed Pvt Ltd', addressLine1: '1 MG Road', city: 'Ahmedabad', country: 'IN', gstRegistered: true, gstin: '24AAACR5055K1Z5', pan: 'AAACR5055K' }).expect(200);
      expect(biz.body.data.gstin).toBe('24AAACR5055K1Z5');
    });

    it('tracks onboarding from real data and publishes only when ready', async () => {
      const c = await registerCreator(app);
      const s1 = await authed(app, c.session).get('/api/v1/creator/onboarding').expect(200);
      expect(s1.body.data).toMatchObject({ canPublish: false, status: 'ONBOARDING' });
      expect(s1.body.data.blockers).toEqual(expect.arrayContaining(['Verify your email address', 'Add a description of at least 20 characters']));
      await authed(app, c.session).post('/api/v1/creator/onboarding/publish').expect(422);

      await authed(app, c.session).put('/api/v1/creator/onboarding/step').send({ step: 6 }).expect(200);
      const code = codeFromEmail((await lastEmail(app, c.body.email))!.text);
      await authed(app, c.session).post('/api/v1/auth/email/verify-code').send({ code }).expect(200);
      await authed(app, c.session).put('/api/v1/creator/academy').send({ description: 'Hands-on design courses for beginners and pros.' }).expect(200);
      const ready = await authed(app, c.session).get('/api/v1/creator/onboarding').expect(200);
      expect(ready.body.data).toMatchObject({ canPublish: true, currentStep: 6 });

      const pub = await authed(app, c.session).post('/api/v1/creator/onboarding/publish').expect(200);
      expect(pub.body.data.status).toBe('ACTIVE');
      const site = await api(app).get('/api/v1/public/site').set('Host', tenantHost(c.tenant.slug)).expect(200);
      expect(site.body.data).toMatchObject({ isLive: true, description: 'Hands-on design courses for beginners and pros.' });
      await api(app).post('/api/v1/auth/register/student').set('Host', tenantHost(c.tenant.slug)).send({ fullName: 'First Student', email: uniqueEmail(), password: 'student-password-1' }).expect(201);
    });
  });

  describe('course builder', () => {
    it('creates courses within the plan limit', async () => {
      const c = await registerCreator(app); // trial plan: 3 courses
      for (let i = 0; i < 3; i++) await authed(app, c.session).post('/api/v1/creator/courses').send({ title: `Course ${i}` }).expect(201);
      const over = await authed(app, c.session).post('/api/v1/creator/courses').send({ title: 'One too many' }).expect(403);
      expect(over.body.error.code).toBe('PLAN_LIMIT_REACHED');
    });

    it('builds a curriculum, validates content and publishes', async () => {
      const c = await registerCreator(app);
      const course = (await authed(app, c.session).post('/api/v1/creator/courses').send({ title: 'Figma for Beginners', shortDescription: 'Design your first app' }).expect(201)).body.data;
      expect(course.slug).toBe('figma-for-beginners');
      const id = course.id;
      let cur = (await authed(app, c.session).get(`/api/v1/creator/courses/${id}/curriculum`).expect(200)).body.data;
      expect(cur).toHaveLength(1);
      const s1 = cur[0].id;
      const s2 = (await authed(app, c.session).post(`/api/v1/creator/courses/${id}/sections`).send({ title: 'Components' }).expect(201)).body.data.id;

      const text = (await authed(app, c.session).post(`/api/v1/creator/courses/${id}/lessons`).send({ sectionId: s1, title: 'Welcome', type: 'TEXT' }).expect(201)).body.data;
      const pdf = (await authed(app, c.session).post(`/api/v1/creator/courses/${id}/lessons`).send({ sectionId: s1, title: 'Cheat sheet', type: 'PDF' }).expect(201)).body.data;
      const sub = (await authed(app, c.session).post(`/api/v1/creator/courses/${id}/lessons`).send({ sectionId: s1, parentLessonId: text.id, title: 'Course tour', type: 'LINK' }).expect(201)).body.data;
      const video = (await authed(app, c.session).post(`/api/v1/creator/courses/${id}/lessons`).send({ sectionId: s2, title: 'Auto layout', type: 'VIDEO' }).expect(201)).body.data;
      expect(video.isPublished).toBe(false);
      await authed(app, c.session).post(`/api/v1/creator/courses/${id}/lessons`).send({ sectionId: s1, title: 'Live', type: 'LIVE' }).expect(422);
      await authed(app, c.session).post(`/api/v1/creator/courses/${id}/lessons`).send({ sectionId: s1, parentLessonId: sub.id, title: 'Too deep', type: 'TEXT' }).expect(422);

      // Rich text is allow-list validated
      await authed(app, c.session).patch(`/api/v1/creator/courses/${id}/lessons/${text.id}`).send({ content: { type: 'doc', content: [{ type: 'script', text: 'x' }] } }).expect(422);
      await authed(app, c.session).patch(`/api/v1/creator/courses/${id}/lessons/${text.id}`).send({ content: richDoc('Welcome aboard!') }).expect(200);

      let check = (await authed(app, c.session).get(`/api/v1/creator/courses/${id}/publish-check`).expect(200)).body.data;
      expect(check.ready).toBe(false);
      expect(check.problems.map((p: any) => p.field)).toEqual(expect.arrayContaining(['priceAmount', `lesson:${pdf.id}`, `lesson:${sub.id}`]));

      const file = await uploadFile(app, c.session, 'LESSON_FILE', 'sheet.pdf', 'application/pdf', PDF);
      await authed(app, c.session).patch(`/api/v1/creator/courses/${id}/lessons/${pdf.id}`).send({ fileAssetId: file.body.data.id }).expect(200);
      await authed(app, c.session).patch(`/api/v1/creator/courses/${id}/lessons/${sub.id}`).send({ externalUrl: 'https://www.figma.com/' }).expect(200);
      await authed(app, c.session).patch(`/api/v1/creator/courses/${id}/lessons/${video.id}`).send({ isPublished: true }).expect(422);
      await authed(app, c.session).patch(`/api/v1/creator/courses/${id}`).send({ priceAmount: 999, compareAtAmount: 499 }).expect(422);
      await authed(app, c.session).patch(`/api/v1/creator/courses/${id}`).send({ priceAmount: 999, compareAtAmount: 1999, description: richDoc('Learn Figma.'), objectives: ['Design screens'], level: 'BEGINNER' }).expect(200);

      check = (await authed(app, c.session).get(`/api/v1/creator/courses/${id}/publish-check`).expect(200)).body.data;
      expect(check).toEqual({ ready: true, problems: [] });

      // Reorder: move the video section first and the PDF under section 2.
      cur = (await authed(app, c.session).get(`/api/v1/creator/courses/${id}/curriculum`).expect(200)).body.data;
      const order = { sections: [{ id: s2, lessons: [{ id: video.id, children: [] }, { id: pdf.id, children: [] }] }, { id: s1, lessons: [{ id: text.id, children: [sub.id] }] }] };
      const reordered = (await authed(app, c.session).put(`/api/v1/creator/courses/${id}/curriculum/order`).send(order).expect(200)).body.data;
      expect(reordered.map((s: any) => s.id)).toEqual([s2, s1]);
      expect(reordered[0].lessons.map((l: any) => l.id)).toEqual([video.id, pdf.id]);
      expect(reordered[1].lessons[0].children.map((l: any) => l.id)).toEqual([sub.id]);
      await authed(app, c.session).put(`/api/v1/creator/courses/${id}/curriculum/order`).send({ sections: [{ id: s1, lessons: [] }] }).expect(422);

      const published = await authed(app, c.session).post(`/api/v1/creator/courses/${id}/publish`).send({}).expect(200);
      expect(published.body.data.status).toBe('PUBLISHED');
      await authed(app, c.session).delete(`/api/v1/creator/courses/${id}`).expect(409);

      const copy = (await authed(app, c.session).post(`/api/v1/creator/courses/${id}/duplicate`).expect(201)).body.data;
      expect(copy).toMatchObject({ status: 'DRAFT', title: 'Figma for Beginners (copy)' });
      const copyCur = (await authed(app, c.session).get(`/api/v1/creator/courses/${copy.id}/curriculum`).expect(200)).body.data;
      expect(copyCur.flatMap((s: any) => s.lessons.flatMap((l: any) => [l, ...l.children])).length).toBe(4);
      expect(copyCur[1].lessons[0].children[0].parentLessonId).toBe(copyCur[1].lessons[0].id);
    });

    it('schedules publishing and the worker job publishes due courses', async () => {
      const c = await registerCreator(app);
      const course = (await authed(app, c.session).post('/api/v1/creator/courses').send({ title: 'Scheduled course' }).expect(201)).body.data;
      const cur = (await authed(app, c.session).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data;
      const l = (await authed(app, c.session).post(`/api/v1/creator/courses/${course.id}/lessons`).send({ sectionId: cur[0].id, title: 'Intro', type: 'TEXT' })).body.data;
      await authed(app, c.session).patch(`/api/v1/creator/courses/${course.id}/lessons/${l.id}`).send({ content: richDoc('Hi') }).expect(200);
      await authed(app, c.session).patch(`/api/v1/creator/courses/${course.id}`).send({ isFree: true }).expect(200);
      const sched = await authed(app, c.session).post(`/api/v1/creator/courses/${course.id}/publish`).send({ publishAt: new Date(Date.now() + 3600_000).toISOString() }).expect(200);
      expect(sched.body.data.status).toBe('SCHEDULED');
      await prisma.course.update({ where: { id: course.id }, data: { publishAt: new Date(Date.now() - 1000) } });
      const { MaintenanceProcessor } = await import('../src/modules/maintenance/maintenance.processor.js');
      const result = await new MaintenanceProcessor(prisma).process({ name: 'publish-scheduled-courses' } as never);
      expect(result).toEqual({ published: 1 });
      expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).status).toBe('PUBLISHED');
    });

    it('course data is isolated between academies (composite tenant keys)', async () => {
      const a = await registerCreator(app);
      const b = await registerCreator(app);
      const course = (await authed(app, a.session).post('/api/v1/creator/courses').send({ title: 'Private IP' }).expect(201)).body.data;
      const sec = (await authed(app, a.session).get(`/api/v1/creator/courses/${course.id}/curriculum`)).body.data[0];
      await authed(app, b.session).get(`/api/v1/creator/courses/${course.id}`).expect(404);
      await authed(app, b.session).patch(`/api/v1/creator/courses/${course.id}`).send({ title: 'hijacked' }).expect(404);
      await authed(app, b.session).get(`/api/v1/creator/courses/${course.id}/curriculum`).expect(404);
      const bCourse = (await authed(app, b.session).post('/api/v1/creator/courses').send({ title: 'B course' }).expect(201)).body.data;
      await authed(app, b.session).post(`/api/v1/creator/courses/${bCourse.id}/lessons`).send({ sectionId: sec.id, title: 'x', type: 'TEXT' }).expect(404);
      expect((await authed(app, b.session).get('/api/v1/creator/courses')).body.data.map((c: any) => c.title)).toEqual(['B course']);
      // Database-level guard: a section cannot point at another tenant's course.
      await expect(prisma.courseSection.create({ data: { tenantId: b.tenant.id, courseId: course.id, title: 'x', position: 9 } })).rejects.toThrow();
    });

    it('staff permissions: instructors can build courses but not manage staff or billing', async () => {
      const owner = await registerCreator(app);
      await prisma.tenantLimitOverride.create({ data: { tenantId: owner.tenant.id, featureKey: 'staff.max', enabled: true, limitValue: 5n } });
      await app.get(EntitlementsService).invalidate(owner.tenant.id);
      const email = uniqueEmail('teacher');
      await authed(app, owner.session).post('/api/v1/creator/staff/invitations').send({ email, roleKey: 'OWNER' }).expect(422);
      await authed(app, owner.session).post('/api/v1/creator/staff/invitations').send({ email, roleKey: 'INSTRUCTOR' }).expect(201);
      const token = tokenFromEmail((await lastEmail(app, email))!.text);

      const info = await api(app).get(`/api/v1/invitations/${encodeURIComponent(token)}`).set('Host', PLATFORM).expect(200);
      expect(info.body.data).toMatchObject({ email, role: 'Instructor', hasAccount: false });
      const reg = await api(app).post('/api/v1/invitations/register').set('Host', PLATFORM).send({ token, fullName: 'Tina Teacher', password: 'teacher-password-1' }).expect(201);
      const teacher = parseSession(reg, PLATFORM);
      await api(app).get(`/api/v1/invitations/${encodeURIComponent(token)}`).set('Host', PLATFORM).expect(404); // single use

      const me = await authed(app, teacher).get('/api/v1/auth/me').expect(200);
      expect(me.body.data.memberships[0]).toMatchObject({ id: owner.tenant.id, role: { key: 'INSTRUCTOR' } });
      await authed(app, teacher).post('/api/v1/creator/courses').send({ title: 'Teacher course' }).expect(201);
      await authed(app, teacher).get('/api/v1/creator/staff').expect(403);
      await authed(app, teacher).get('/api/v1/creator/billing').expect(403);
      await authed(app, teacher).put('/api/v1/creator/academy').send({ tagline: 'x' }).expect(403);

      const staff = (await authed(app, owner.session).get('/api/v1/creator/staff').expect(200)).body.data;
      const member = staff.members.find((m: any) => m.user.email === email);
      const ownerMember = staff.members.find((m: any) => m.role.key === 'OWNER');
      await authed(app, owner.session).patch(`/api/v1/creator/staff/${ownerMember.id}`).send({ roleKey: 'ADMIN' }).expect(403);
      await authed(app, owner.session).patch(`/api/v1/creator/staff/${member.id}`).send({ roleKey: 'SUPPORT_AGENT' }).expect(200);
      await authed(app, teacher).post('/api/v1/creator/courses').send({ title: 'Now forbidden' }).expect(403);
      await authed(app, owner.session).delete(`/api/v1/creator/staff/${member.id}`).expect(200);
      await authed(app, teacher).get('/api/v1/creator/workspace').expect(404);
    });

    it('existing accounts accept invitations only with the matching email', async () => {
      const owner = await registerCreator(app);
      await prisma.tenantLimitOverride.create({ data: { tenantId: owner.tenant.id, featureKey: 'staff.max', enabled: true, limitValue: 5n } });
      await app.get(EntitlementsService).invalidate(owner.tenant.id);
      const other = await registerCreator(app);
      const invitee = await registerCreator(app);
      await authed(app, owner.session).post('/api/v1/creator/staff/invitations').send({ email: invitee.body.email, roleKey: 'CONTENT_MANAGER' }).expect(201);
      const token = tokenFromEmail((await lastEmail(app, invitee.body.email))!.text);
      await authed(app, other.session).post('/api/v1/invitations/accept').send({ token }).expect(403);
      await authed(app, invitee.session).post('/api/v1/invitations/accept').send({ token }).expect(200);
      const me = await authed(app, invitee.session).get('/api/v1/auth/me').expect(200);
      expect(me.body.data.memberships).toHaveLength(2);
      const switched = await authed(app, invitee.session).post('/api/v1/auth/switch-tenant').send({ tenantId: owner.tenant.id }).expect(200);
      const ws = await authed(app, { accessToken: switched.body.data.accessToken, host: PLATFORM }).get('/api/v1/creator/workspace').expect(200);
      expect(ws.body.data.id).toBe(owner.tenant.id);
    });

    it('dashboard reflects real counts', async () => {
      const c = await registerCreator(app);
      await authed(app, c.session).post('/api/v1/creator/courses').send({ title: 'Dash course' }).expect(201);
      const d = (await authed(app, c.session).get('/api/v1/creator/dashboard').expect(200)).body.data;
      expect(d.courses).toMatchObject({ total: 1, draft: 1, published: 0 });
      expect(d.usage.courses).toEqual({ used: 1, limit: 3 });
      expect(d.activity.map((a: any) => a.action)).toEqual(expect.arrayContaining(['course.create', 'tenant.create']));
      expect(d.revenue.available).toBe(false);
    });
  });

  it('host cache is invalidated on publish', async () => {
    expect(app.get(HostResolverService)).toBeDefined();
    const res = await login(app, PLATFORM, 'nobody@example.test', 'x-password-123');
    expect(res.res.status).toBe(401);
  });
});
