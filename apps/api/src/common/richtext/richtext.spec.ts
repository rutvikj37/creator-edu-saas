import { richTextToPlain, validateRichText } from './richtext.js';

const doc = (content: unknown[]) => ({ type: 'doc', content });

describe('validateRichText', () => {
  it('accepts normal formatted content', () => {
    expect(() => validateRichText(doc([{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Intro' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'See ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://x.test' } }] }] }]))).not.toThrow();
  });
  it('rejects script vectors', () => {
    expect(() => validateRichText(doc([{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }]))).toThrow(/Links/);
    expect(() => validateRichText(doc([{ type: 'html', content: [] }]))).toThrow(/Unsupported/);
    expect(() => validateRichText(doc([{ type: 'paragraph', attrs: { onclick: 'x' } }]))).toThrow(/attribute/);
    expect(() => validateRichText({ type: 'paragraph' })).toThrow(/document/);
  });
  it('extracts plain text', () => {
    expect(richTextToPlain(doc([{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }])).trim()).toBe('Hello');
  });
});
