/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and newlines inside quotes,
 * CRLF or LF line endings, and a leading BOM (Excel). Returns an array of rows (arrays of strings).
 */
export function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_ALIASES = {
  fullName: ['name', 'full name', 'fullname', 'student name', 'student'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  phone: ['phone', 'mobile', 'phone number', 'mobile number', 'contact', 'whatsapp'],
};

/** Maps a parsed CSV (first row = headers) to `{ fullName, email, phone }` rows. Throws when there's no email column. */
export function csvToStudents(rows) {
  if (!rows.length) throw new Error('The file is empty.');
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[_*]/g, ' ').replace(/\s+/g, ' '));
  const col = (key) => headers.findIndex((h) => HEADER_ALIASES[key].includes(h));
  const idx = { fullName: col('fullName'), email: col('email'), phone: col('phone') };
  if (idx.email < 0) throw new Error('No "email" column found. Use the template: name, email, phone.');
  return rows.slice(1).map((r) => ({
    fullName: idx.fullName >= 0 ? (r[idx.fullName] ?? '').trim() : '',
    email: (r[idx.email] ?? '').trim(),
    phone: idx.phone >= 0 ? (r[idx.phone] ?? '').trim() : '',
  }));
}

export const STUDENT_CSV_TEMPLATE = 'name,email,phone\nPriya Sharma,priya@example.com,+919876543210\nRahul Verma,rahul@example.com,\n';
