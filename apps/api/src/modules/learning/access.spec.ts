import { enrollmentExpiry, isEnrollmentUsable, progressPercent, unlockTime } from './access.js';

const base = { enrolledAt: new Date('2026-01-01T00:00:00Z'), section: { dripOffsetDays: null, unlockAt: null }, lesson: { dripOffsetDays: null, unlockAt: null } };

describe('lesson access rules', () => {
  it('drips by days after enrolment, lesson overriding section', () => {
    expect(unlockTime({ ...base, dripType: 'NONE', section: { dripOffsetDays: 7, unlockAt: null } })).toBeNull();
    expect(unlockTime({ ...base, dripType: 'DAYS_AFTER_ENROLL', section: { dripOffsetDays: 7, unlockAt: null } })?.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(unlockTime({ ...base, dripType: 'DAYS_AFTER_ENROLL', section: { dripOffsetDays: 7, unlockAt: null }, lesson: { dripOffsetDays: 2, unlockAt: null } })?.toISOString()).toBe('2026-01-03T00:00:00.000Z');
    expect(unlockTime({ ...base, dripType: 'DATE', section: { dripOffsetDays: null, unlockAt: new Date('2026-02-01T00:00:00Z') } })?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
  it('computes access expiry', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(enrollmentExpiry({ accessType: 'LIFETIME', accessDays: null, accessUntil: null }, start)).toBeNull();
    expect(enrollmentExpiry({ accessType: 'FIXED_DAYS', accessDays: 30, accessUntil: null }, start)?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
  it('rejects expired or revoked enrolments', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(isEnrollmentUsable({ status: 'ACTIVE', expiresAt: null }, now)).toBe(true);
    expect(isEnrollmentUsable({ status: 'ACTIVE', expiresAt: new Date('2026-05-01T00:00:00Z') }, now)).toBe(false);
    expect(isEnrollmentUsable({ status: 'REVOKED', expiresAt: null }, now)).toBe(false);
    expect(isEnrollmentUsable(null, now)).toBe(false);
  });
  it('computes progress over required lessons', () => {
    expect(progressPercent(['a', 'b', 'c'], new Set(['a', 'x']))).toBe(33);
    expect(progressPercent([], new Set())).toBe(0);
  });
});
