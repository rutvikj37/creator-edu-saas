import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, FEATURES, ERROR_CODES } from './index.js';

test('feature keys are unique', () => {
  assert.equal(new Set(FEATURE_KEYS).size, Object.keys(FEATURES).length);
});

test('error codes map to themselves', () => {
  for (const [k, v] of Object.entries(ERROR_CODES)) assert.equal(k, v);
});

import { PERMISSIONS, ROLE_PERMISSIONS } from './index.js';
test('every role permission exists in the catalog', () => {
  const keys = new Set(Object.values(PERMISSIONS));
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) for (const p of perms) assert.ok(keys.has(p), `${role}: ${p}`);
});
test('tenant roles never receive platform permissions', () => {
  for (const r of ['OWNER', 'ADMIN', 'INSTRUCTOR']) assert.ok(ROLE_PERMISSIONS[r].every((p) => !p.startsWith('platform.')));
});
