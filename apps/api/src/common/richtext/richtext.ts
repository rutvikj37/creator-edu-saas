/**
 * Rich text is stored as TipTap/ProseMirror JSON and validated against an allow-list,
 * so no raw HTML or script can ever be stored. Unknown nodes/marks/attributes are rejected.
 */
const NODES: Record<string, string[]> = {
  doc: [], paragraph: ['textAlign'], text: [], heading: ['level', 'textAlign'], bulletList: [], orderedList: ['start', 'type'], listItem: [],
  blockquote: [], codeBlock: ['language'], hardBreak: [], horizontalRule: [],
};
const MARKS: Record<string, string[]> = { bold: [], italic: [], underline: [], strike: [], code: [], link: ['href', 'target', 'rel', 'class'] };
const MAX_NODES = 5000;
const MAX_TEXT = 200_000;

export class RichTextError extends Error {}

function safeHref(href: unknown) {
  return typeof href === 'string' && href.length <= 2000 && /^(https?:\/\/|mailto:)/i.test(href);
}

export function validateRichText(doc: unknown): void {
  let count = 0;
  let textLen = 0;
  const walk = (node: any, depth: number) => {
    if (depth > 30) throw new RichTextError('Content is nested too deeply');
    if (++count > MAX_NODES) throw new RichTextError('Content is too long');
    if (!node || typeof node !== 'object' || typeof node.type !== 'string' || !(node.type in NODES)) throw new RichTextError(`Unsupported content element: ${node?.type}`);
    for (const k of Object.keys(node)) if (!['type', 'attrs', 'content', 'text', 'marks'].includes(k)) throw new RichTextError('Unexpected property in content');
    if (node.attrs) {
      for (const [k, v] of Object.entries(node.attrs)) {
        if (!NODES[node.type].includes(k)) throw new RichTextError(`Unsupported attribute ${k}`);
        if (v !== null && typeof v === 'object') throw new RichTextError('Invalid attribute value');
      }
      if (node.type === 'heading' && ![1, 2, 3, 4].includes(node.attrs.level)) throw new RichTextError('Invalid heading level');
    }
    if (node.type === 'text') {
      if (typeof node.text !== 'string') throw new RichTextError('Invalid text');
      textLen += node.text.length;
      if (textLen > MAX_TEXT) throw new RichTextError('Content is too long');
    }
    for (const m of node.marks ?? []) {
      if (!m || !(m.type in MARKS)) throw new RichTextError(`Unsupported formatting: ${m?.type}`);
      for (const k of Object.keys(m.attrs ?? {})) if (!MARKS[m.type].includes(k)) throw new RichTextError(`Unsupported attribute ${k}`);
      if (m.type === 'link' && !safeHref(m.attrs?.href)) throw new RichTextError('Links must start with http(s):// or mailto:');
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new RichTextError('Invalid content');
      node.content.forEach((c: unknown) => walk(c, depth + 1));
    }
  };
  if (!doc || (doc as any).type !== 'doc') throw new RichTextError('Content must be a document');
  walk(doc, 0);
}

/** Plain-text extraction (search, summaries, SEO fallbacks). */
export function richTextToPlain(doc: any): string {
  if (!doc) return '';
  if (doc.type === 'text') return doc.text ?? '';
  const inner = (doc.content ?? []).map(richTextToPlain).join(doc.type === 'doc' ? '\n' : '');
  return ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'].includes(doc.type) ? `${inner}\n` : inner;
}
