import { isCorrect, scoreAttempt, shuffle, type GradableQuestion } from './grading.js';

const opt = (id: string, isCorrect = false, matchKey: string | null = null) => ({ id, label: id, isCorrect, matchKey });
const single: GradableQuestion = { id: 'q1', type: 'MCQ_SINGLE', points: 2, meta: null, options: [opt('a', true), opt('b')] };
const multi: GradableQuestion = { id: 'q2', type: 'MCQ_MULTI', points: 3, meta: null, options: [opt('a', true), opt('b', true), opt('c')] };
const blank: GradableQuestion = { id: 'q3', type: 'FILL_BLANK', points: 1, meta: { answers: ['Print', 'print()'] }, options: [] };
const match: GradableQuestion = { id: 'q4', type: 'MATCHING', points: 2, meta: null, options: [opt('l1', false, 'list'), opt('l2', false, 'dict')] };
const essay: GradableQuestion = { id: 'q5', type: 'LONG', points: 5, meta: null, options: [] };

describe('grading', () => {
  it('grades each auto type', () => {
    expect(isCorrect(single, { optionId: 'a' })).toBe(true);
    expect(isCorrect(single, { optionId: 'b' })).toBe(false);
    expect(isCorrect(multi, { optionIds: ['b', 'a'] })).toBe(true);
    expect(isCorrect(multi, { optionIds: ['a'] })).toBe(false);
    expect(isCorrect(multi, { optionIds: ['a', 'b', 'c'] })).toBe(false);
    expect(isCorrect(blank, { text: '  print() ' })).toBe(true);
    expect(isCorrect(blank, { text: 'echo' })).toBe(false);
    expect(isCorrect({ ...blank, meta: { answers: ['Print'], caseSensitive: true } }, { text: 'print' })).toBe(false);
    expect(isCorrect(match, { pairs: { l1: 'list', l2: 'dict' } })).toBe(true);
    expect(isCorrect(match, { pairs: { l1: 'dict', l2: 'list' } })).toBe(false);
    expect(isCorrect(essay, { text: 'anything' })).toBeNull();
  });

  it('applies negative marking only to wrong answers and floors at zero', () => {
    const r = scoreAttempt([single, multi, blank], { q1: { optionId: 'b' }, q2: { optionIds: ['a', 'b'] } }, 0.5);
    expect(r).toMatchObject({ score: 2, maxScore: 6, percent: 33.33, pendingManual: 0 }); // -1 + 3 + 0 (unanswered)
    expect(scoreAttempt([single], { q1: { optionId: 'b' } }, 1).score).toBe(0);
  });

  it('tracks manual questions until graded', () => {
    const pending = scoreAttempt([single, essay], { q1: { optionId: 'a' } });
    expect(pending).toMatchObject({ score: 2, maxScore: 7, pendingManual: 1 });
    const graded = scoreAttempt([single, essay], { q1: { optionId: 'a' } }, 0, { q5: 4 });
    expect(graded).toMatchObject({ score: 6, pendingManual: 0 });
    expect(scoreAttempt([essay], {}, 0, { q5: 99 }).score).toBe(5); // capped at question points
  });

  it('shuffles deterministically with an injected random source', () => {
    let s = 1;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    expect(shuffle([1, 2, 3, 4, 5], rand).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
