/**
 * Website templates: a visual style plus starter pages built only from the academy's own
 * details (name, tagline, description, real course catalogue). Templates never invent
 * testimonials, statistics or claims — creators add those themselves.
 */
export interface TemplateInput {
  name: string;
  tagline: string | null;
  description: string | null;
  supportEmail: string | null;
}

interface StarterPage {
  slug: string;
  title: string;
  isHome?: boolean;
  showInNav?: boolean;
  blocks: unknown[];
}

const para = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const heading = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

function homeBlocks(a: TemplateInput, variant: 'classic' | 'minimal' | 'bold') {
  const hero = { id: 'hero', type: 'hero', props: { heading: a.name, subheading: a.tagline ?? '', ctaLabel: 'Browse courses', ctaHref: '/courses', align: variant === 'minimal' ? 'left' : 'center' } };
  const courses = { id: 'courses', type: 'courseGrid', props: { heading: variant === 'bold' ? 'Start learning today' : 'Courses', mode: 'all', limit: variant === 'minimal' ? 3 : 6 } };
  const about = a.description ? [{ id: 'about', type: 'richText', props: { content: doc(heading(`About ${a.name}`), para(a.description)) } }] : [];
  const cta = { id: 'cta', type: 'cta', props: { heading: 'Ready to begin?', text: '', buttonLabel: 'See all courses', buttonHref: '/courses' } };
  return variant === 'minimal' ? [hero, courses, ...about] : [hero, courses, ...about, cta];
}

function commonPages(a: TemplateInput): StarterPage[] {
  return [
    { slug: 'about', title: 'About', blocks: [{ id: 'about', type: 'richText', props: { content: doc(heading(`About ${a.name}`), para(a.description ?? '')) } }] },
    { slug: 'contact', title: 'Contact', blocks: [{ id: 'contact', type: 'contact', props: { heading: 'Get in touch', email: a.supportEmail ?? '', phone: '', address: '' } }] },
  ];
}

export const TEMPLATES = {
  classic: {
    name: 'Classic',
    description: 'Centered hero, course grid, about section and a call to action.',
    pages: (a: TemplateInput): StarterPage[] => [{ slug: 'home', title: 'Home', isHome: true, showInNav: false, blocks: homeBlocks(a, 'classic') }, ...commonPages(a)],
  },
  minimal: {
    name: 'Minimal',
    description: 'Left-aligned, lots of white space, a short course list.',
    pages: (a: TemplateInput): StarterPage[] => [{ slug: 'home', title: 'Home', isHome: true, showInNav: false, blocks: homeBlocks(a, 'minimal') }, ...commonPages(a)],
  },
  bold: {
    name: 'Bold',
    description: 'Large headings and strong colour blocks for a confident brand.',
    pages: (a: TemplateInput): StarterPage[] => [{ slug: 'home', title: 'Home', isHome: true, showInNav: false, blocks: homeBlocks(a, 'bold') }, ...commonPages(a)],
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;
