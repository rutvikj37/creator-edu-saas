import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, FEATURES, ERROR_CODES } from './index.js';

test('feature keys are unique', () => {
  assert.equal(new Set(FEATURE_KEYS).size, Object.keys(FEATURES).length);
});

test('error codes map to themselves', () => {
  for (const [k, v] of Object.entries(ERROR_CODES)) assert.equal(k, v);
});
