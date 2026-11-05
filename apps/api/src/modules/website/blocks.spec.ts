import { describe, expect, it } from 'vitest';
import { parseBlocks, referencedFiles } from './blocks.js';

const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] };

describe('parseBlocks', () => {
  it('accepts valid blocks and fills defaults', () => {
    const r = parseBlocks([
      { id: 'a', type: 'hero', props: { heading: 'Learn yoga' } },
      { id: 'b', type: 'richText', props: { content: doc }, hidden: true },
      { id: 'c', type: 'courseGrid', props: {} },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.blocks[0]).toEqual({ id: 'a', type: 'hero', hidden: false, props: { heading: 'Learn yoga', subheading: '', ctaLabel: '', ctaHref: '', imageFileId: null, align: 'center' } });
    expect(r.blocks[1].hidden).toBe(true);
    expect(r.blocks[2].props).toMatchObject({ mode: 'all', limit: 6, courseIds: [] });
  });

  it('rejects unsafe links, non-YouTube/Vimeo video, unknown types and duplicate ids', () => {
    const r = parseBlocks([
      { id: 'a', type: 'cta', props: { heading: 'Go', buttonLabel: 'Click', buttonHref: 'javascript:alert(1)' } },
      { id: 'b', type: 'video', props: { url: 'https://evil.example/video.mp4' } },
      { id: 'c', type: 'marquee', props: {} },
      { id: 'c', type: 'hero', props: { heading: 'x' } },
      { id: 'd', type: 'cta', props: { heading: 'Go', buttonLabel: 'Click', buttonHref: '//evil.example' } },
    ]);
    expect(r.errors.map((e) => e.field)).toEqual(['blocks.0.props.buttonHref', 'blocks.1.props.url', 'blocks.2.type', 'blocks.3.id', 'blocks.4.props.buttonHref']);
  });

  it('validates rich text and image alt text', () => {
    const r = parseBlocks([
      { id: 'a', type: 'richText', props: { content: { type: 'doc', content: [{ type: 'script' }] } } },
      { id: 'b', type: 'image', props: { fileId: 'c'.repeat(25), alt: '' } },
    ]);
    expect(r.errors.map((e) => e.field)).toEqual(['blocks.0.props.content', 'blocks.1.props.alt']);
  });

  it('accepts safe links and collects referenced files', () => {
    const r = parseBlocks([
      { id: 'a', type: 'cta', props: { heading: 'Go', buttonLabel: 'Browse', buttonHref: '/courses' } },
      { id: 'b', type: 'hero', props: { heading: 'x', ctaHref: 'https://wa.me/919999999999', imageFileId: 'f'.repeat(25) } },
      { id: 'c', type: 'video', props: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
    ]);
    expect(r.errors).toEqual([]);
    expect(referencedFiles(r.blocks)).toEqual(['f'.repeat(25)]);
  });
});
