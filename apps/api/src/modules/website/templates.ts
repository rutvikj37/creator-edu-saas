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
  const hero = {
    id: 'hero',
    type: 'hero',
    props: {
      heading: a.tagline || `Learn with ${a.name}`,
      subheading: a.description
        ? a.description.slice(0, 180)
        : 'Structured courses, live classes and certificates — learn at your pace with a clear path to finishing.',
      ctaLabel: 'Browse courses',
      ctaHref: '/courses',
      ctaSecondaryLabel: 'Start learning',
      ctaSecondaryHref: '/register',
      align: variant === 'minimal' ? 'left' : 'left',
    },
  };
  const how = {
    id: 'how',
    type: 'features',
    props: {
      heading: 'How it works',
      items: [
        { title: 'Choose a programme', text: 'Browse published courses and pick the skills you need next.' },
        { title: 'Learn live and on demand', text: 'Watch lessons when it suits you, and join live sessions when your cohort meets.' },
        { title: 'Finish with a certificate', text: 'Complete the coursework and download a certificate you can share.' },
      ],
    },
  };
  const courses = {
    id: 'courses',
    type: 'courseGrid',
    props: {
      heading: variant === 'bold' ? 'Start learning today' : 'Featured programmes',
      mode: 'all',
      limit: variant === 'minimal' ? 3 : 6,
    },
  };
  const live = {
    id: 'live',
    type: 'features',
    props: {
      heading: 'Live classes & community',
      items: [
        { title: 'Scheduled live sessions', text: 'Show up for mentor-led classes and ask questions in the moment.' },
        { title: 'Learner community', text: 'Stay accountable with peers who are working through the same material.' },
        { title: 'Practical outcomes', text: 'Projects and checkpoints designed around skills employers recognise.' },
      ],
    },
  };
  const about = a.description
    ? [{ id: 'about', type: 'richText', props: { content: doc(heading(`About ${a.name}`), para(a.description)) } }]
    : [];
  const cta = {
    id: 'cta',
    type: 'cta',
    props: {
      heading: `Start learning with ${a.name}`,
      text: a.tagline || 'Browse the catalogue and enrol in a few clicks.',
      buttonLabel: 'Browse courses',
      buttonHref: '/courses',
    },
  };
  if (variant === 'minimal') return [hero, courses, ...about];
  if (variant === 'bold') return [hero, how, courses, cta];
  return [hero, how, courses, live, cta];
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
    description: 'Brand-led hero, how it works, course grid, live learning and a final call to action.',
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
