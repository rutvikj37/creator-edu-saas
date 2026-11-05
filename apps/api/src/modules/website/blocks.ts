import { z } from 'zod';
import { RichTextError, validateRichText } from '../../common/richtext/richtext.js';

/**
 * Page blocks. Every block is validated here before it is stored, so the public renderer can
 * trust the shape. Links are internal paths or http(s) URLs only; videos are YouTube/Vimeo embeds.
 */
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).optional().default('');
const cuid = z.string().length(25);
export const SAFE_HREF = /^(\/(?!\/)[^\s]*|https?:\/\/[^\s]+|mailto:[^\s]+|#[\w-]*)$/i;
const href = z.string().trim().max(500).refine((v) => v === '' || SAFE_HREF.test(v), 'Use a path like /courses or a full https:// link');
const VIDEO_HOSTS = /^https:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]{6,}|youtu\.be\/[\w-]{6,}|vimeo\.com\/\d+)/i;
const richDoc = z.unknown().superRefine((doc, ctx) => {
  try {
    validateRichText(doc);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: e instanceof RichTextError ? e.message : 'Invalid rich text' });
  }
});

export const BLOCK_PROPS = {
  hero: z.object({ heading: text(120).min(1), subheading: optText(300), ctaLabel: optText(40), ctaHref: href.optional().default(''), imageFileId: cuid.nullable().optional().default(null), align: z.enum(['left', 'center']).default('center') }),
  richText: z.object({ content: richDoc }),
  courseGrid: z.object({ heading: optText(120), mode: z.enum(['all', 'selected']).default('all'), courseIds: z.array(cuid).max(24).default([]), limit: z.number().int().min(1).max(24).default(6) }),
  features: z.object({ heading: optText(120), items: z.array(z.object({ title: text(80).min(1), text: optText(300) })).min(1).max(12) }),
  testimonials: z.object({ heading: optText(120), items: z.array(z.object({ quote: text(500).min(1), name: text(80).min(1), role: optText(80) })).min(1).max(12) }),
  faq: z.object({ heading: optText(120), items: z.array(z.object({ q: text(200).min(1), a: text(2000).min(1) })).min(1).max(30) }),
  cta: z.object({ heading: text(120).min(1), text: optText(300), buttonLabel: text(40).min(1), buttonHref: href }),
  image: z.object({ fileId: cuid, alt: text(160).min(1, 'Describe the image for screen readers'), caption: optText(200) }),
  video: z.object({ url: z.string().trim().regex(VIDEO_HOSTS, 'Paste a YouTube or Vimeo link'), caption: optText(200) }),
  instructor: z.object({ name: text(80).min(1), title: optText(120), bio: text(1500).min(1), photoFileId: cuid.nullable().optional().default(null) }),
  stats: z.object({ items: z.array(z.object({ value: text(20).min(1), label: text(60).min(1) })).min(1).max(6) }),
  contact: z.object({ heading: optText(120), email: z.union([z.literal(''), z.email()]).default(''), phone: optText(30), address: optText(300) }),
} as const;

export type BlockType = keyof typeof BLOCK_PROPS;
export const BLOCK_TYPES = Object.keys(BLOCK_PROPS) as BlockType[];
export const MAX_BLOCKS = 60;
const MAX_BYTES = 200_000;

export interface Block {
  id: string;
  type: BlockType;
  hidden: boolean;
  props: Record<string, unknown>;
}

export interface BlockError {
  field: string;
  message: string;
}

/** Validates and normalises a block list. Returns errors addressed as blocks.<index>.<path>. */
export function parseBlocks(input: unknown): { blocks: Block[]; errors: BlockError[] } {
  const errors: BlockError[] = [];
  if (!Array.isArray(input)) return { blocks: [], errors: [{ field: 'blocks', message: 'Blocks must be a list' }] };
  if (input.length > MAX_BLOCKS) errors.push({ field: 'blocks', message: `A page can have at most ${MAX_BLOCKS} blocks` });
  if (JSON.stringify(input).length > MAX_BYTES) errors.push({ field: 'blocks', message: 'This page is too large — split it into more pages' });
  const ids = new Set<string>();
  const blocks: Block[] = [];
  input.slice(0, MAX_BLOCKS).forEach((raw: any, i) => {
    const at = `blocks.${i}`;
    if (!raw || typeof raw !== 'object') return errors.push({ field: at, message: 'Invalid block' });
    const id = typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : null;
    if (!id || ids.has(id)) return errors.push({ field: `${at}.id`, message: 'Each block needs a unique id' });
    ids.add(id);
    const schema = BLOCK_PROPS[raw.type as BlockType];
    if (!schema) return errors.push({ field: `${at}.type`, message: `Unknown block type "${String(raw.type)}"` });
    const r = schema.safeParse(raw.props ?? {});
    if (!r.success) {
      for (const issue of r.error.issues) {
        // Replace zod's generic "Too small" wording for empty required values; keep custom messages.
        const required = issue.code === 'too_small' && Number((issue as { minimum?: number | bigint }).minimum) === 1 && /^Too small/.test(issue.message);
        errors.push({ field: [at, 'props', ...issue.path.map(String)].join('.'), message: required ? (issue.path.length > 1 ? 'Fill in every item, or remove the empty ones' : 'This field is required') : issue.message });
      }
      return;
    }
    blocks.push({ id, type: raw.type, hidden: raw.hidden === true, props: r.data as Record<string, unknown> });
  });
  return { blocks, errors };
}

/** File ids a block list references (so the public renderer can sign URLs for them). */
export function referencedFiles(blocks: Block[]): string[] {
  const out = new Set<string>();
  for (const b of blocks) {
    for (const k of ['imageFileId', 'fileId', 'photoFileId']) {
      const v = b.props[k];
      if (typeof v === 'string' && v.length === 25) out.add(v);
    }
  }
  return [...out];
}

export const PAGE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
/** Paths owned by the app itself; pages cannot take them. */
export const RESERVED_PAGE_SLUGS = new Set(['courses', 'learn', 'login', 'register', 'checkout', 'blog', 'verify', 'api', 'reset-password', 'forgot-password', 'verify-email', 'p', 'sitemap.xml', 'robots.txt']);
