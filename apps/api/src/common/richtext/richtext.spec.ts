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

describe('richTextToHtml', () => {
  it('renders allowed formatting and escapes text', async () => {
    const { richTextToHtml } = await import('./richtext.js');
    const html = richTextToHtml({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hi <there>' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Read ', marks: [] }, { type: 'text', text: 'this', marks: [{ type: 'link', attrs: { href: 'https://example.test/?a=1&b="2"' } }, { type: 'bold' }] }] },
    ] });
    expect(html).toBe('<h2>Hi &lt;there&gt;</h2><p>Read <strong><a href="https://example.test/?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noopener noreferrer">this</a></strong></p>');
    expect(() => richTextToHtml({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] })).toThrow();
  });
});
