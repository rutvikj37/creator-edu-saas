import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scopeArgs, TENANT_MODELS } from './tenant-prisma.js';

describe('scopeArgs', () => {
  it('adds tenantId to reads, updates and deletes (overriding any client value)', () => {
    expect(scopeArgs('findMany', { where: { tenantId: 'evil', status: 'x' } }, 't1').where).toEqual({ tenantId: 't1', status: 'x' });
    expect(scopeArgs('findUnique', { where: { id: 'a' } }, 't1').where).toEqual({ id: 'a', tenantId: 't1' });
    expect(scopeArgs('deleteMany', undefined, 't1').where).toEqual({ tenantId: 't1' });
    expect(scopeArgs('count', {}, 't1').where).toEqual({ tenantId: 't1' });
  });
  it('stamps tenantId on creates', () => {
    expect(scopeArgs('create', { data: { name: 'x', tenantId: 'evil' } }, 't1').data.tenantId).toBe('t1');
    expect(scopeArgs('createMany', { data: [{ a: 1 }, { a: 2 }] }, 't1').data.every((d: any) => d.tenantId === 't1')).toBe(true);
    const u = scopeArgs('upsert', { where: { id: 'a' }, create: { a: 1 }, update: {} }, 't1');
    expect(u.where.tenantId).toBe('t1');
    expect(u.create.tenantId).toBe('t1');
  });
  it('refuses to move rows between tenants', () => {
    expect(() => scopeArgs('update', { where: { id: 'a' }, data: { tenantId: 't2' } }, 't1')).toThrow(/not allowed/);
  });
});

describe('TENANT_MODELS registry', () => {
  it('lists every model that has a required tenantId column', () => {
    const schema = readFileSync(fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url)), 'utf8');
    const owned = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)]
      .filter(([, , body]) => /^\s+tenantId\s+String\s+@/m.test(body))
      .map(([, name]) => name);
    expect(owned.sort()).toEqual([...TENANT_MODELS].sort());
  });
});
