import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { AiClient, type AiCall } from '../src/modules/ai/ai.client.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, registerCreator, resetDatabase, tenantHost } from './helpers.js';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

describe('Academy website modes: external website or AI landing page (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let c: Awaited<ReturnType<typeof registerCreator>>;
  let host: string;
  const calls: AiCall<any>[] = [];
  let reply: (call: AiCall<any>) => unknown;
  const courseIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    const ai = app.get(AiClient);
    Object.defineProperty(ai, 'configured', { get: () => true });
    ai.generate = (async (call: AiCall<any>) => { calls.push(call); return reply(call); }) as never;
    c = await registerCreator(app);
    host = tenantHost(c.tenant.slug);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    const profile = { tagline: 'Money skills for working professionals', supportEmail: 'hello@meera.example', description: 'Practical personal finance courses.' };
    await prisma.academy.upsert({ where: { tenantId: c.tenant.id }, create: { tenantId: c.tenant.id, ...profile }, update: profile });
    await app.get(HostResolverService).invalidate(host);
    await prisma.tenantLimitOverride.create({ data: { tenantId: c.tenant.id, featureKey: 'ai.credits', enabled: true, limitValue: 500, reason: 'test' } as never });
    await app.get(EntitlementsService).invalidate(c.tenant.id);
    for (const title of ['Mutual Funds 101', 'Tax Saving Basics']) {
      const co = (await authed(app, c.session).post('/api/v1/creator/courses').send({ title }).expect(201)).body.data;
      const sec = (await authed(app, c.session).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
      const l = (await authed(app, c.session).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
      await authed(app, c.session).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hi'), isPublished: true }).expect(200);
      await authed(app, c.session).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: true }).expect(200);
      await authed(app, c.session).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
      courseIds.push(co.id);
    }
  });
  afterAll(async () => app?.close());

  it('external website: validated https address, exposed to the academy site; courses stay on the platform', async () => {
    const put = (body: object) => authed(app, c.session).put('/api/v1/creator/website/settings').send(body);
    expect((await put({ mode: 'EXTERNAL' }).expect(422)).body.error.details[0].field).toBe('externalUrl');
    for (const bad of ['http://meera.example', 'ftp://meera.example', 'not a url', `https://${c.tenant.slug}.lvh.me`, 'https://localhost', 'https://user:pw@meera.example']) {
      await put({ mode: 'EXTERNAL', externalUrl: bad }).expect(422);
    }
    await prisma.tenantDomain.create({ data: { tenantId: c.tenant.id, hostname: 'learn.meera.example', type: 'CUSTOM', verificationToken: 'test-token' } as never });
    expect((await put({ mode: 'EXTERNAL', externalUrl: 'https://learn.meera.example' }).expect(422)).body.error.details[0].message).toMatch(/connected to your academy/);
    const ok = (await put({ mode: 'EXTERNAL', externalUrl: 'https://www.meera.example/#top' }).expect(200)).body.data;
    expect(ok).toMatchObject({ mode: 'EXTERNAL', externalUrl: 'https://www.meera.example/' });
    const layout = (await api(app).get('/api/v1/public/website/layout').set('Host', host).expect(200)).body.data;
    expect(layout).toMatchObject({ mode: 'EXTERNAL', externalUrl: 'https://www.meera.example/' });
    // Catalogue and course pages keep working for students arriving from the external site.
    expect((await api(app).get('/api/v1/public/courses').set('Host', host).expect(200)).body.data.length).toBe(2);
    // Back to the platform page: the address is kept but not exposed while unused.
    await put({ mode: 'PLATFORM' }).expect(200);
    expect((await api(app).get('/api/v1/public/website/layout').set('Host', host).expect(200)).body.data).toMatchObject({ mode: 'PLATFORM', externalUrl: null });
  });

  it('AI landing page: generated from real profile and courses, saved as a draft, previous draft kept, no invented proof', async () => {
    reply = () => ({
      output: {
        seoTitle: 'Meera Finance Academy — personal finance courses', seoDescription: 'Learn mutual funds and tax saving with practical courses.',
        hero: { heading: 'Make your salary work for you', subheading: 'Practical money courses for working professionals.', ctaLabel: 'Explore courses' },
        features: { heading: 'Why learn here', items: [{ title: 'Practical lessons', text: 'Apply what you learn the same day.' }, { title: '', text: 'dropped' }] },
        courses: { heading: 'Start with these', featuredCourseIds: [courseIds[1], 'ckinventedxxxxxxxxxxxxxxx', courseIds[0]] },
        about: { heading: 'About Meera', paragraphs: ['Meera teaches personal finance.', ''] },
        faq: { heading: 'Questions', items: [{ q: 'How do I pay?', a: 'By UPI, cards, net banking or wallets.' }] },
        cta: { heading: 'Ready?', text: 'Pick your first course.', buttonLabel: 'Browse courses' },
      },
      text: '', model: 'claude-opus-5-5', inputTokens: 2000, cachedTokens: 0, outputTokens: 1500, stopReason: 'end_turn',
    });
    // An existing home draft (edited by the creator) must not be lost.
    await authed(app, c.session).post('/api/v1/creator/website/templates/classic/apply').send({}).expect(200);
    const res = (await authed(app, c.session).post('/api/v1/creator/website/ai-landing').send({ industry: 'Personal finance', audience: 'Salaried professionals in India', tone: 'friendly', language: 'en', highlights: 'Ex-banker, simple explanations' }).expect(200)).body.data;
    expect(res.credits).toBe(10); // 2000/1000 + 1500/200 = 9.5 → 10
    const call = calls.at(-1)!;
    expect(call.context).toContain('Mutual Funds 101');
    expect(call.context).toContain('Ex-banker');
    expect(call.system).toMatch(/Never invent testimonials/);
    const blocks = res.page.draftBlocks as { type: string; props: any }[];
    expect(blocks.map((b) => b.type)).toEqual(['hero', 'features', 'courseGrid', 'richText', 'faq', 'cta', 'contact']);
    expect(blocks.some((b) => b.type === 'testimonials')).toBe(false);
    expect(blocks[0].props).toMatchObject({ heading: 'Make your salary work for you', ctaHref: '/courses' });
    expect(blocks[1].props.items).toEqual([{ title: 'Practical lessons', text: 'Apply what you learn the same day.' }]);
    expect(blocks[2].props).toMatchObject({ mode: 'selected', courseIds: [courseIds[1], courseIds[0]] }); // invented id dropped
    expect(blocks[6].props).toMatchObject({ email: 'hello@meera.example' });
    expect(res.page).toMatchObject({ isHome: true, seoTitle: 'Meera Finance Academy — personal finance courses', hasUnpublishedChanges: true });
    const versions = (await authed(app, c.session).get(`/api/v1/creator/website/pages/${res.page.id}/versions`).expect(200)).body.data;
    expect(versions.some((v: any) => v.note === 'Draft before AI generation')).toBe(true);
    // Not public until published.
    await api(app).get('/api/v1/public/website/pages/home').set('Host', host).expect(404);
    await authed(app, c.session).post(`/api/v1/creator/website/pages/${res.page.id}/publish`).send({ note: 'AI landing' }).expect(200);
    const pub = (await api(app).get('/api/v1/public/website/pages/home').set('Host', host).expect(200)).body.data;
    expect(pub.blocks[0].props.heading).toBe('Make your salary work for you');
    expect(pub.data.courses.courses.map((x: any) => x.title)).toEqual(['Tax Saving Basics', 'Mutual Funds 101']);
    expect((await api(app).get('/api/v1/public/website/layout').set('Host', host).expect(200)).body.data).toMatchObject({ mode: 'PLATFORM', hasHomePage: true });
  });

  it('AI landing: Hindi requested, validation and credit limits', async () => {
    reply = () => ({ output: null, text: '', model: 'm', inputTokens: 10, cachedTokens: 0, outputTokens: 10, stopReason: 'refusal' });
    await authed(app, c.session).post('/api/v1/creator/website/ai-landing').send({ industry: 'x' }).expect(422); // too short
    await authed(app, c.session).post('/api/v1/creator/website/ai-landing').send({ industry: 'Yoga', language: 'fr' }).expect(422);
    expect((await authed(app, c.session).post('/api/v1/creator/website/ai-landing').send({ industry: 'Yoga', language: 'hi' }).expect(422)).body.error.message).toMatch(/declined/);
    expect(calls.at(-1)!.system).toMatch(/Hindi/);
    await prisma.tenantLimitOverride.updateMany({ where: { tenantId: c.tenant.id, featureKey: 'ai.credits' }, data: { limitValue: 5 } as never });
    await app.get(EntitlementsService).invalidate(c.tenant.id);
    expect((await authed(app, c.session).post('/api/v1/creator/website/ai-landing').send({ industry: 'Yoga' }).expect(403)).body.error.code).toBe('PLAN_LIMIT_REACHED');
  });
});
