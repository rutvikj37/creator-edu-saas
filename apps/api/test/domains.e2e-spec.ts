import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { HostResolverService } from '../src/core/tenancy/host-resolver.service.js';
import { api, authed, createTestApp, registerCreator, resetDatabase, tenantHost } from './helpers.js';

describe('Domains: branded subdomain or own domain (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  async function academy(businessName?: string) {
    const c = await registerCreator(app, businessName ? { businessName } : {});
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: 'ACTIVE' } });
    await app.get(HostResolverService).invalidate(tenantHost(c.tenant.slug));
    return c;
  }
  const site = (host: string) => api(app).get('/api/v1/public/site').set('Host', host);

  it('adds branded subdomains that work instantly, with availability checks, primary switching and safe removal', async () => {
    const a = await academy();
    const b = await academy();
    const as = a.session;

    const list0 = (await authed(app, as).get('/api/v1/creator/domains').expect(200)).body.data;
    expect(list0).toEqual([expect.objectContaining({ hostname: tenantHost(a.tenant.slug), type: 'SUBDOMAIN', isPrimary: true, isDefault: true, status: 'VERIFIED' })]);

    // Availability: invalid, reserved, taken by another academy's slug, free.
    const check = async (name: string) => (await authed(app, as).get(`/api/v1/creator/domains/subdomains/availability?name=${encodeURIComponent(name)}`).expect(200)).body.data;
    expect(await check('ab')).toMatchObject({ available: false });
    expect(await check('admin')).toMatchObject({ available: false });
    expect(await check(b.tenant.slug)).toMatchObject({ available: false, reason: 'This subdomain is already taken' });
    expect(await check('Meera-Learns')).toEqual({ name: 'meera-learns', hostname: 'meera-learns.lvh.me', available: true, reason: null });

    const added = (await authed(app, as).post('/api/v1/creator/domains/subdomains').send({ name: 'meera-learns' }).expect(201)).body.data;
    expect(added).toMatchObject({ hostname: 'meera-learns.lvh.me', type: 'SUBDOMAIN', status: 'VERIFIED', isPrimary: false, isDefault: false, dnsInstructions: [] });
    expect((await site('meera-learns.lvh.me').expect(200)).body.data.slug).toBe(a.tenant.slug);

    // Taken for everyone else, including as a new academy's slug.
    await authed(app, b.session).post('/api/v1/creator/domains/subdomains').send({ name: 'meera-learns' }).expect(422);
    const clash = await academy('Meera Learns');
    expect(clash.tenant.slug).not.toBe('meera-learns');
    // Own-domain option still refuses platform addresses.
    await authed(app, as).post('/api/v1/creator/domains').send({ hostname: 'other.lvh.me' }).expect(422);

    // Make it primary: links and the workspace use it.
    await authed(app, as).patch(`/api/v1/creator/domains/${added.id}/primary`).expect(200);
    expect((await authed(app, as).get('/api/v1/creator/workspace')).body.data.primaryHostname).toBe('meera-learns.lvh.me');

    // Limit of 3 subdomains, including the original.
    await authed(app, as).post('/api/v1/creator/domains/subdomains').send({ name: 'meera-courses' }).expect(201);
    const over = await authed(app, as).post('/api/v1/creator/domains/subdomains').send({ name: 'meera-third' }).expect(422);
    expect(over.body.error.details[0].message).toMatch(/up to 3 subdomains/);

    // The original cannot be removed; removing the primary falls back to the original and stops routing.
    const original = list0[0];
    await authed(app, as).delete(`/api/v1/creator/domains/${original.id}`).expect(422);
    await authed(app, b.session).delete(`/api/v1/creator/domains/${added.id}`).expect(404);
    await authed(app, as).delete(`/api/v1/creator/domains/${added.id}`).expect(200);
    const after = (await authed(app, as).get('/api/v1/creator/domains')).body.data;
    expect(after.find((d: any) => d.isPrimary).hostname).toBe(tenantHost(a.tenant.slug));
    await site('meera-learns.lvh.me').expect(404);
    // ...and the name is free again.
    expect(await check('meera-learns')).toMatchObject({ available: true });
  });
});
