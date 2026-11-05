import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, PNG, registerCreator, resetDatabase, type Session, tenantHost, uploadFile } from './helpers.js';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('Website builder (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  async function academy() {
    const c = await registerCreator(app);
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await prisma.academy.upsert({ where: { tenantId: c.tenant.id }, update: { tagline: 'Learn by building', description: 'Hands-on coding courses.' }, create: { tenantId: c.tenant.id, tagline: 'Learn by building', description: 'Hands-on coding courses.' } as never });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    return c;
  }
  async function course(cs: Session, title: string, publish: boolean) {
    const co = (await authed(app, cs).post('/api/v1/creator/courses').send({ title }).expect(201)).body.data;
    if (!publish) return co;
    const sec = (await authed(app, cs).get(`/api/v1/creator/courses/${co.id}/curriculum`)).body.data[0].id;
    const l = (await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/lessons`).send({ sectionId: sec, title: 'Intro', type: 'TEXT' }).expect(201)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}/lessons/${l.id}`).send({ content: doc('Hello'), isPublished: true }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/courses/${co.id}`).send({ isFree: true }).expect(200);
    await authed(app, cs).post(`/api/v1/creator/courses/${co.id}/publish`).send({}).expect(200);
    return co;
  }

  it('template → edit draft → publish → preview drafts → versions → navigation → home rules', async () => {
    const c = await academy();
    const cs = c.session;
    const host = tenantHost(c.tenant.slug);
    const pub = (path: string) => api(app).get(`/api/v1/public${path}`).set('Host', host);
    const live = await course(cs, 'Python from zero', true);
    await course(cs, 'Unpublished draft course', false);

    // Nothing is public before publishing.
    await pub('/website/pages/home').expect(404);
    expect((await pub('/website/layout').expect(200)).body.data).toMatchObject({ hasHomePage: false, nav: [{ label: 'Courses', href: '/courses' }] });

    // Template creates draft pages from the academy's own content.
    const ov = (await authed(app, cs).post('/api/v1/creator/website/templates/classic/apply').send({}).expect(200)).body.data;
    expect(ov.pages.map((p: any) => [p.slug, p.isHome, p.publishedAt])).toEqual([['home', true, null], ['about', false, null], ['contact', false, null]]);
    const homeId = ov.pages[0].id;
    const home = (await authed(app, cs).get(`/api/v1/creator/website/pages/${homeId}`).expect(200)).body.data;
    expect(home.draftBlocks.map((b: any) => b.type)).toEqual(['hero', 'courseGrid', 'richText', 'cta']);
    expect(home.draftBlocks[0].props).toMatchObject({ heading: c.tenant.name, subheading: 'Learn by building' });
    await authed(app, cs).post('/api/v1/creator/website/templates/nope/apply').send({}).expect(404);

    // Invalid blocks are rejected with addressable errors; images must belong to this academy.
    const bad = await authed(app, cs).patch(`/api/v1/creator/website/pages/${homeId}`).send({ draftBlocks: [{ id: 'x', type: 'cta', props: { heading: 'Hi', buttonLabel: 'Go', buttonHref: 'javascript:alert(1)' } }] }).expect(422);
    expect(bad.body.error.details[0].field).toBe('blocks.0.props.buttonHref');
    // Empty required fields get plain-language messages the builder shows on the field.
    const empty = await authed(app, cs).patch(`/api/v1/creator/website/pages/${homeId}`).send({ draftBlocks: [{ id: 'f', type: 'faq', props: { heading: '', items: [{ q: '', a: 'x' }] } }, { id: 's', type: 'stats', props: { items: [] } }, { id: 'i', type: 'image', props: { fileId: null, alt: '' } }] }).expect(422);
    const msg = Object.fromEntries(empty.body.error.details.map((e: any) => [e.field, e.message]));
    expect(msg['blocks.0.props.items.0.q']).toBe('Fill in every item, or remove the empty ones');
    expect(msg['blocks.1.props.items']).toBe('This field is required');
    expect(msg['blocks.2.props.alt']).toBe('Describe the image for screen readers');
    const other = await academy();
    const foreign = (await uploadFile(app, other.session, 'IMAGE', 'x.png', 'image/png', PNG)).body.data;
    await authed(app, cs).patch(`/api/v1/creator/website/pages/${homeId}`).send({ draftBlocks: [{ id: 'img', type: 'image', props: { fileId: foreign.id, alt: 'x' } }] }).expect(422);
    const mine = (await uploadFile(app, cs, 'IMAGE', 'team.png', 'image/png', PNG)).body.data;

    const v1Blocks = [
      { id: 'hero', type: 'hero', props: { heading: 'Code with confidence', ctaLabel: 'Browse', ctaHref: '/courses', imageFileId: mine.id } },
      { id: 'grid', type: 'courseGrid', props: { heading: 'Courses', mode: 'all', limit: 6 } },
      { id: 'secret', type: 'richText', props: { content: doc('Hidden block') }, hidden: true },
    ];
    const saved = (await authed(app, cs).patch(`/api/v1/creator/website/pages/${homeId}`).send({ draftBlocks: v1Blocks, seoTitle: 'Learn Python online', seoDescription: 'Practical Python courses.' }).expect(200)).body.data;
    expect(saved.hasUnpublishedChanges).toBe(true);
    expect(Object.keys(saved.files)).toEqual([mine.id]);
    await authed(app, cs).post(`/api/v1/creator/website/pages/${homeId}/publish`).send({ note: 'First version' }).expect(200);

    const page = (await pub('/website/pages/home').expect(200)).body.data;
    expect(page.blocks.map((b: any) => b.id)).toEqual(['hero', 'grid']); // hidden block not served
    expect(page.seo).toMatchObject({ title: 'Learn Python online', description: 'Practical Python courses.' });
    expect(page.data.files[mine.id]).toBeTruthy();
    expect(page.data.courses.grid.map((x: any) => x.title)).toEqual(['Python from zero']); // drafts never shown
    expect(page.data.courses.grid[0]).toMatchObject({ id: live.id, isFree: true });

    // Draft edits stay private until published; a preview token shows them.
    await authed(app, cs).patch(`/api/v1/creator/website/pages/${homeId}`).send({ draftBlocks: [{ id: 'hero', type: 'hero', props: { heading: 'New headline' } }] }).expect(200);
    expect((await pub('/website/pages/home')).body.data.blocks[0].props.heading).toBe('Code with confidence');
    const { token } = (await authed(app, cs).post('/api/v1/creator/website/preview-token').expect(200)).body.data;
    expect((await pub(`/website/pages/home?preview=${encodeURIComponent(token)}`)).body.data).toMatchObject({ preview: true, blocks: [{ props: { heading: 'New headline' } }] });
    expect((await pub('/website/pages/home?preview=123.forged')).body.data.preview).toBe(false);
    // A token from another academy does not unlock this one.
    const otherToken = (await authed(app, other.session).post('/api/v1/creator/website/preview-token').expect(200)).body.data.token;
    expect((await pub(`/website/pages/home?preview=${encodeURIComponent(otherToken)}`)).body.data.preview).toBe(false);

    // Versions: publish again, then restore the first version into the draft.
    await authed(app, cs).post(`/api/v1/creator/website/pages/${homeId}/publish`).send({ note: 'Second' }).expect(200);
    const versions = (await authed(app, cs).get(`/api/v1/creator/website/pages/${homeId}/versions`).expect(200)).body.data;
    expect(versions.map((v: any) => v.note)).toEqual(['Second', 'First version']);
    const restored = (await authed(app, cs).post(`/api/v1/creator/website/pages/${homeId}/versions/${versions[1].id}/restore`).expect(200)).body.data;
    expect(restored.draftBlocks.map((b: any) => b.id)).toEqual(['hero', 'grid', 'secret']);
    expect((await pub('/website/pages/home')).body.data.blocks[0].props.heading).toBe('New headline'); // restore does not publish

    // Pages: reserved and duplicate addresses; navigation from published pages and header links.
    await authed(app, cs).post('/api/v1/creator/website/pages').send({ title: 'Courses', slug: 'courses' }).expect(422);
    await authed(app, cs).post('/api/v1/creator/website/pages').send({ title: 'About again', slug: 'about' }).expect(422);
    const aboutId = ov.pages[1].id;
    await authed(app, cs).post(`/api/v1/creator/website/pages/${aboutId}/publish`).send({}).expect(200);
    await authed(app, cs).put('/api/v1/creator/website/settings').send({ header: { links: [{ label: 'Hack', href: 'javascript:void(0)' }] } }).expect(422);
    await authed(app, cs).put('/api/v1/creator/website/settings').send({ header: { showBlogLink: true, links: [{ label: 'WhatsApp', href: 'https://wa.me/919999999999' }] }, footer: { text: '© Acme Academy', links: [{ label: 'Privacy', href: '/p/privacy' }] } }).expect(200);
    const layout = (await pub('/website/layout')).body.data;
    expect(layout.nav).toEqual([{ label: 'Courses', href: '/courses' }, { label: 'About', href: '/p/about' }, { label: 'Blog', href: '/blog' }, { label: 'WhatsApp', href: 'https://wa.me/919999999999' }]);
    expect(layout).toMatchObject({ hasHomePage: true, template: 'classic', footer: { text: '© Acme Academy' } });
    expect((await pub('/website/pages/about')).body.data.title).toBe('About');
    await pub('/website/pages/contact').expect(404); // never published
    await authed(app, cs).post(`/api/v1/creator/website/pages/${aboutId}/unpublish`).expect(200);
    await pub('/website/pages/about').expect(404);

    // The home page cannot be deleted until another page is home.
    await authed(app, cs).delete(`/api/v1/creator/website/pages/${homeId}`).expect(409);
    await authed(app, cs).post(`/api/v1/creator/website/pages/${aboutId}/home`).expect(200);
    await authed(app, cs).delete(`/api/v1/creator/website/pages/${homeId}`).expect(200);

    // Isolation: another academy cannot read or edit these pages, and its site shows none of them.
    await authed(app, other.session).get(`/api/v1/creator/website/pages/${aboutId}`).expect(404);
    await authed(app, other.session).patch(`/api/v1/creator/website/pages/${aboutId}`).send({ title: 'x' }).expect(404);
    await api(app).get('/api/v1/public/website/pages/about').set('Host', tenantHost(other.tenant.slug)).expect(404);
  });

  it('blog drafts and publishing, and the plan feature gate', async () => {
    const c = await academy();
    const cs = c.session;
    const host = tenantHost(c.tenant.slug);
    const p1 = (await authed(app, cs).post('/api/v1/creator/blog/posts').send({ title: 'Why learn Python?' }).expect(201)).body.data;
    expect(p1).toMatchObject({ slug: 'why-learn-python', status: 'DRAFT' });
    const p2 = (await authed(app, cs).post('/api/v1/creator/blog/posts').send({ title: 'Why learn Python?' }).expect(201)).body.data;
    expect(p2.slug).toBe('why-learn-python-2');
    await authed(app, cs).post(`/api/v1/creator/blog/posts/${p1.id}/publish`).expect(422); // empty
    await authed(app, cs).patch(`/api/v1/creator/blog/posts/${p1.id}`).send({ content: { type: 'doc', content: [{ type: 'iframe' }] } }).expect(422);
    await authed(app, cs).patch(`/api/v1/creator/blog/posts/${p1.id}`).send({ content: doc('Python reads like English.'), excerpt: 'A friendly start', tags: ['python', 'beginners'] }).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/blog/posts/${p2.id}`).send({ slug: 'why-learn-python' }).expect(422);
    expect((await api(app).get('/api/v1/public/blog').set('Host', host)).body.meta.total).toBe(0);
    await authed(app, cs).post(`/api/v1/creator/blog/posts/${p1.id}/publish`).expect(200);
    const list = await api(app).get('/api/v1/public/blog').set('Host', host).expect(200);
    expect(list.body.data).toEqual([expect.objectContaining({ slug: 'why-learn-python', excerpt: 'A friendly start', author: 'Asha Creator', tags: ['python', 'beginners'] })]);
    expect(list.body.data[0].content).toBeUndefined();
    const post = (await api(app).get('/api/v1/public/blog/why-learn-python').set('Host', host).expect(200)).body.data;
    expect(post.content.content[0].content[0].text).toBe('Python reads like English.');
    await api(app).get('/api/v1/public/blog/why-learn-python-2').set('Host', host).expect(404);

    // Plans without the website builder cannot use it.
    await prisma.tenantLimitOverride.create({ data: { tenantId: c.tenant.id, featureKey: 'website_builder', enabled: false, reason: 'test' } });
    await app.get(EntitlementsService).invalidate(c.tenant.id);
    const denied = await authed(app, cs).get('/api/v1/creator/website').expect(403);
    expect(denied.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    await authed(app, cs).post('/api/v1/creator/blog/posts').send({ title: 'x' }).expect(403);
  });
});
