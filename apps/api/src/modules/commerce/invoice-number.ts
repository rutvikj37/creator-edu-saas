/** Indian financial year label used in invoice series, e.g. 2026-27 for dates from 1 April 2026. */
export function financialYear(d: Date) {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/**
 * Invoice number for the `seq`-th invoice of a financial year: PREFIX/FY/SERIAL, where the serial
 * starts at the academy's chosen number. GST requires a unique series per financial year (max 16
 * characters is advised), so the year stays in the number.
 */
export function invoiceNumber(prefix: string, fy: string, start: number, seq: number) {
  return `${prefix}/${fy}/${String(Math.max(1, start) + seq - 1).padStart(5, '0')}`;
}
