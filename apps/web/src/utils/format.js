/**
 * Locale-aware formatting. Never hardcode currency symbols or time zones:
 * the currency comes from the record, the locale/timezone from the user or tenant.
 */
export function formatMoney(amount, currency, locale = 'en-IN') {
  if (amount === null || amount === undefined || !currency) return '—';
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}

export function formatNumber(value, locale = 'en-IN', options = {}) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatDate(value, { locale = 'en-IN', timeZone, withTime = false } = {}) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}
