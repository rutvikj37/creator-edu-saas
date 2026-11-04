/**
 * Pure grading rules (unit-tested). Auto-graded: MCQ_SINGLE, TRUE_FALSE, MCQ_MULTI (all-or-nothing),
 * FILL_BLANK (normalised text match), MATCHING (all pairs). SHORT/LONG/FILE_UPLOAD need an instructor.
 */
export interface GradableQuestion {
  id: string;
  type: string;
  points: number;
  meta: { answers?: string[]; caseSensitive?: boolean } | null;
  options: Array<{ id: string; label: string; isCorrect: boolean; matchKey: string | null }>;
}

export const MANUAL_TYPES = new Set(['SHORT', 'LONG', 'FILE_UPLOAD']);

export type Response = { optionId?: string; optionIds?: string[]; text?: string; pairs?: Record<string, string> } | null | undefined;

const norm = (s: string, caseSensitive?: boolean) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return caseSensitive ? t : t.toLowerCase();
};

/** null = needs manual grading. */
export function isCorrect(q: GradableQuestion, r: Response): boolean | null {
  if (MANUAL_TYPES.has(q.type)) return null;
  if (!r) return false;
  switch (q.type) {
    case 'MCQ_SINGLE':
    case 'TRUE_FALSE':
      return Boolean(q.options.find((o) => o.id === r.optionId)?.isCorrect);
    case 'MCQ_MULTI': {
      const correct = q.options.filter((o) => o.isCorrect).map((o) => o.id).sort();
      const given = [...new Set(r.optionIds ?? [])].sort();
      return correct.length > 0 && correct.length === given.length && correct.every((id, i) => id === given[i]);
    }
    case 'FILL_BLANK': {
      if (typeof r.text !== 'string' || !r.text.trim()) return false;
      return (q.meta?.answers ?? []).some((a) => norm(a, q.meta?.caseSensitive) === norm(r.text!, q.meta?.caseSensitive));
    }
    case 'MATCHING': {
      const left = q.options.filter((o) => o.matchKey);
      return left.length > 0 && left.every((o) => r.pairs?.[o.id] === o.matchKey);
    }
    default:
      return false;
  }
}

export interface AttemptScore {
  score: number;
  maxScore: number;
  percent: number;
  pendingManual: number;
  perQuestion: Record<string, { isCorrect: boolean | null; points: number | null }>;
}

/**
 * Totals an attempt. Wrong auto-graded answers lose `negativeRatio × points`; unanswered questions
 * never lose points; the total never drops below zero. Manual grades (if provided) are included.
 */
export function scoreAttempt(questions: GradableQuestion[], responses: Record<string, Response>, negativeRatio = 0, manual: Record<string, number | null> = {}): AttemptScore {
  let score = 0;
  let maxScore = 0;
  let pendingManual = 0;
  const perQuestion: AttemptScore['perQuestion'] = {};
  for (const q of questions) {
    maxScore += q.points;
    if (MANUAL_TYPES.has(q.type)) {
      const m = manual[q.id];
      if (m === undefined || m === null) {
        pendingManual += 1;
        perQuestion[q.id] = { isCorrect: null, points: null };
      } else {
        const pts = Math.max(0, Math.min(q.points, m));
        score += pts;
        perQuestion[q.id] = { isCorrect: pts >= q.points, points: pts };
      }
      continue;
    }
    const r = responses[q.id];
    const answered = r !== undefined && r !== null && (r.optionId || r.optionIds?.length || r.text?.trim() || (r.pairs && Object.keys(r.pairs).length));
    const ok = isCorrect(q, r);
    const pts = ok ? q.points : answered ? -q.points * negativeRatio : 0;
    score += pts;
    perQuestion[q.id] = { isCorrect: Boolean(ok), points: Math.round(pts * 100) / 100 };
  }
  score = Math.max(0, Math.round(score * 100) / 100);
  return { score, maxScore, percent: maxScore ? Math.round((score / maxScore) * 10000) / 100 : 0, pendingManual, perQuestion };
}

/** Fisher–Yates shuffle with an injectable random source (deterministic in tests). */
export function shuffle<T>(items: T[], rand = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
