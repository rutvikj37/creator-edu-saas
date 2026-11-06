import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { EntitlementsService } from '../src/modules/subscriptions/entitlements.service.js';
import { api, authed, createTestApp, lastEmail, parseSession, PLATFORM, registerCreator, resetDatabase, type Session, tokenFromEmail, uniqueEmail } from './helpers.js';

describe('Custom team roles (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
  });
  afterAll(async () => app?.close());

  async function owner() {
    const o = await registerCreator(app);
    await prisma.tenantLimitOverride.create({ data: { tenantId: o.tenant.id, featureKey: 'staff.max', enabled: true, limitValue: 10n } });
    await app.get(EntitlementsService).invalidate(o.tenant.id);
    return o;
  }
  async function join(inviter: Session, roleKey: string, name: string) {
    const email = uniqueEmail('team');
    await authed(app, inviter).post('/api/v1/creator/staff/invitations').send({ email, roleKey }).expect(201);
    const token = tokenFromEmail((await lastEmail(app, email))!.text);
    const reg = await api(app).post('/api/v1/invitations/register').set('Host', PLATFORM).send({ token, fullName: name, password: 'team-password-123' }).expect(201);
    return parseSession(reg, PLATFORM);
  }

  it('owner builds a role from chosen permissions; members get exactly those; edits apply at once; no escalation; delete rules; isolation', async () => {
    const o = await owner();
    const cs = o.session;
    const cat = (await authed(app, cs).get('/api/v1/creator/roles/permissions').expect(200)).body.data;
    const keys = cat.flatMap((g: any) => g.items.map((i: any) => i.key));
    expect(keys).toContain('courses.manage');
    expect(keys).not.toContain('billing.manage');
    const builtIn = (await authed(app, cs).get('/api/v1/creator/roles').expect(200)).body.data;
    expect(builtIn.map((r: any) => r.key)).toEqual(expect.arrayContaining(['ADMIN', 'INSTRUCTOR', 'SUPPORT_AGENT']));

    // Validation: billing can't be granted; names unique; at least one permission.
    expect((await authed(app, cs).post('/api/v1/creator/roles').send({ name: 'Bad', permissions: ['billing.manage'] }).expect(422)).body.error.details[0].field).toBe('permissions');
    await authed(app, cs).post('/api/v1/creator/roles').send({ name: 'Empty', permissions: [] }).expect(422);
    await authed(app, cs).post('/api/v1/creator/roles').send({ name: 'Instructor', permissions: ['courses.read'] }).expect(422);
    const editor = (await authed(app, cs).post('/api/v1/creator/roles').send({ name: 'Course editor', permissions: ['courses.read', 'courses.manage'] }).expect(201)).body.data;
    expect(editor).toMatchObject({ name: 'Course editor', custom: true, permissions: ['courses.manage', 'courses.read'], members: 0 });
    expect((await authed(app, cs).get('/api/v1/creator/staff')).body.data.assignableRoles).toEqual(expect.arrayContaining([{ key: editor.key, name: 'Course editor', custom: true }]));

    // A member with the custom role can do exactly what it allows.
    const ed = await join(cs, editor.key, 'Esha Editor');
    expect((await authed(app, ed).get('/api/v1/auth/me')).body.data.memberships[0].role).toMatchObject({ key: editor.key });
    await authed(app, ed).post('/api/v1/creator/courses').send({ title: 'Editor course' }).expect(201);
    await authed(app, ed).get('/api/v1/creator/orders').expect(403);
    await authed(app, ed).get('/api/v1/creator/roles').expect(403);

    // Editing the role applies immediately.
    await authed(app, cs).patch(`/api/v1/creator/roles/${editor.id}`).send({ permissions: ['courses.read', 'courses.manage', 'orders.read'] }).expect(200);
    await authed(app, ed).get('/api/v1/creator/orders').expect(200);
    expect((await authed(app, cs).get('/api/v1/creator/roles')).body.data.find((r: any) => r.id === editor.id).members).toBe(1);

    // A team lead who can manage staff cannot hand out more than they have.
    const lead = (await authed(app, cs).post('/api/v1/creator/roles').send({ name: 'Team lead', permissions: ['staff.manage', 'courses.read'] }).expect(201)).body.data;
    const tl = await join(cs, lead.key, 'Tara Lead');
    await authed(app, tl).post('/api/v1/creator/staff/invitations').send({ email: uniqueEmail('x'), roleKey: 'ADMIN' }).expect(403);
    await authed(app, tl).post('/api/v1/creator/staff/invitations').send({ email: uniqueEmail('x'), roleKey: editor.key }).expect(403); // editor has courses.manage
    const r = await authed(app, tl).post('/api/v1/creator/roles').send({ name: 'Refunder', permissions: ['refunds.manage'] }).expect(422);
    expect(r.body.error.details[0].message).toMatch(/do not have/);
    const viewer = (await authed(app, tl).post('/api/v1/creator/roles').send({ name: 'Viewer', permissions: ['courses.read'] }).expect(201)).body.data;
    const staff = (await authed(app, cs).get('/api/v1/creator/staff')).body.data;
    const edMember = staff.members.find((m: any) => m.user.fullName === 'Esha Editor');
    const tlMember = staff.members.find((m: any) => m.user.fullName === 'Tara Lead');
    await authed(app, tl).patch(`/api/v1/creator/staff/${tlMember.id}`).send({ roleKey: 'ADMIN' }).expect(403); // no self-promotion
    await authed(app, tl).patch(`/api/v1/creator/staff/${edMember.id}`).send({ roleKey: viewer.key }).expect(403); // cannot demote someone holding more

    // Roles in use cannot be deleted; move the member first.
    await authed(app, cs).delete(`/api/v1/creator/roles/${editor.id}`).expect(409);
    await authed(app, cs).patch(`/api/v1/creator/staff/${edMember.id}`).send({ roleKey: viewer.key }).expect(200);
    await authed(app, ed).post('/api/v1/creator/courses').send({ title: 'Now read-only' }).expect(403);
    await authed(app, cs).delete(`/api/v1/creator/roles/${editor.id}`).expect(200);
    await authed(app, cs).patch(`/api/v1/creator/roles/${builtIn.find((x: any) => x.key === 'ADMIN').id}`).send({ name: 'Boss' }).expect(404); // built-in roles are fixed

    // Another academy cannot see or use these roles.
    const other = await owner();
    expect((await authed(app, other.session).get('/api/v1/creator/roles')).body.data.map((x: any) => x.name)).not.toContain('Viewer');
    await authed(app, other.session).patch(`/api/v1/creator/roles/${viewer.id}`).send({ name: 'Mine' }).expect(404);
    await authed(app, other.session).delete(`/api/v1/creator/roles/${viewer.id}`).expect(404);
    await authed(app, other.session).post('/api/v1/creator/staff/invitations').send({ email: uniqueEmail('y'), roleKey: viewer.key }).expect(422);
  });
});
