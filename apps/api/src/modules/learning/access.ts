/**
 * Pure access rules for lessons (unit-tested). A lesson is available to an enrolled student when
 * the enrolment is active and not expired, the lesson is published, and its drip time has passed.
 */
export interface DripInput {
  dripType: 'NONE' | 'DAYS_AFTER_ENROLL' | 'DATE';
  enrolledAt: Date;
  section: { dripOffsetDays: number | null; unlockAt: Date | null };
  lesson: { dripOffsetDays: number | null; unlockAt: Date | null };
}

const DAY = 86_400_000;

/** When the lesson unlocks (null = immediately). Lesson-level settings override section-level. */
export function unlockTime(i: DripInput): Date | null {
  if (i.dripType === 'DAYS_AFTER_ENROLL') {
    const days = i.lesson.dripOffsetDays ?? i.section.dripOffsetDays;
    return days ? new Date(i.enrolledAt.getTime() + days * DAY) : null;
  }
  if (i.dripType === 'DATE') return i.lesson.unlockAt ?? i.section.unlockAt ?? null;
  return null;
}

export function enrollmentExpiry(course: { accessType: string; accessDays: number | null; accessUntil: Date | null }, start: Date): Date | null {
  if (course.accessType === 'FIXED_DAYS' && course.accessDays) return new Date(start.getTime() + course.accessDays * DAY);
  if (course.accessType === 'FIXED_DATE' && course.accessUntil) return course.accessUntil;
  return null;
}

export function isEnrollmentUsable(e: { status: string; expiresAt: Date | null } | null, now = new Date()): boolean {
  return Boolean(e && (e.status === 'ACTIVE' || e.status === 'COMPLETED') && (!e.expiresAt || e.expiresAt > now));
}

/** Percentage of required, published lessons completed (0–100, integer). */
export function progressPercent(requiredLessonIds: string[], completedIds: Set<string>): number {
  if (!requiredLessonIds.length) return 0;
  const done = requiredLessonIds.filter((id) => completedIds.has(id)).length;
  return Math.floor((done / requiredLessonIds.length) * 100);
}
