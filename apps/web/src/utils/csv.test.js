import { describe, expect, it } from 'vitest';
import { csvToStudents, parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas/newlines, CRLF and BOM', () => {
    const text = '\uFEFFname,email\r\n"Doe, Jane",jane@x.com\r\n"Say ""hi""\nthere",a@b.co\r\n\r\n';
    expect(parseCsv(text)).toEqual([['name', 'email'], ['Doe, Jane', 'jane@x.com'], ['Say "hi"\nthere', 'a@b.co']]);
  });
  it('keeps a last line without a trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('csvToStudents', () => {
  it('maps common header names in any order', () => {
    const rows = parseCsv('Mobile Number,E-mail,Full Name\n98765 43210, x@y.com ,Asha\n');
    expect(csvToStudents(rows)).toEqual([{ fullName: 'Asha', email: 'x@y.com', phone: '98765 43210' }]);
  });
  it('works with only an email column', () => {
    expect(csvToStudents(parseCsv('email\na@b.co'))).toEqual([{ fullName: '', email: 'a@b.co', phone: '' }]);
  });
  it('rejects files without an email column', () => {
    expect(() => csvToStudents(parseCsv('name,phone\nA,1'))).toThrow(/email/);
  });
});
