/**
 * 1 AI credit ≈ 1,000 input tokens or 200 output tokens (output costs ~5× input on Claude).
 * Thinking tokens are output tokens, so they count too. Every call costs at least 1 credit.
 */
export function creditsFor(inputTokens: number, outputTokens: number, cachedTokens = 0): number {
  // Cache reads cost ~1/10 of normal input, so repeated context (the tutor's lesson text) is cheap.
  return Math.max(1, Math.ceil((inputTokens + cachedTokens / 10) / 1000 + outputTokens / 200));
}

/** Upper bound reserved before a call: the prompt (≈3 chars/token, rounded up) plus max_tokens of output. */
export function reserveFor(promptChars: number, maxTokens: number): number {
  return creditsFor(Math.ceil(promptChars / 3), maxTokens);
}

/** Start of the current calendar month in a time zone, as a UTC instant. */
export function monthStart(now: Date, timeZone: string): { start: Date; next: Date } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(now).map((x) => [x.type, x.value]));
  const y = Number(p.year);
  const m = Number(p.month);
  return { start: zoned(y, m, timeZone), next: m === 12 ? zoned(y + 1, 1, timeZone) : zoned(y, m + 1, timeZone) };
}

function zoned(y: number, m: number, timeZone: string) {
  const guess = Date.UTC(y, m - 1, 1);
  const offset = (t: number) => {
    const q = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(Number(q.year), Number(q.month) - 1, Number(q.day), Number(q.hour), Number(q.minute), Number(q.second)) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}
