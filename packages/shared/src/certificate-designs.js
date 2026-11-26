/**
 * Built-in certificate visual designs. `designKey` is stored on CertificateTemplate;
 * PDF and the creator preview both switch layout by this key. Text fields (title,
 * body, signatory) stay editable — selecting a design mainly changes the frame/style
 * and offers a suggested accent colour.
 */
export const CERTIFICATE_DESIGNS = {
  classic: {
    key: 'classic',
    name: 'Classic',
    description: 'Double border with centred serif title — the traditional completion certificate.',
    suggestedAccent: '#4f46e5',
    suggestedTitle: 'Certificate of Completion',
  },
  elegant: {
    key: 'elegant',
    name: 'Elegant',
    description: 'Ornate corner flourishes and generous spacing for a formal award feel.',
    suggestedAccent: '#b45309',
    suggestedTitle: 'Certificate of Achievement',
  },
  modern: {
    key: 'modern',
    name: 'Modern',
    description: 'Clean side accent bar and contemporary type — sharp and brand-forward.',
    suggestedAccent: '#0f766e',
    suggestedTitle: 'Certificate of Completion',
  },
  formal: {
    key: 'formal',
    name: 'Formal',
    description: 'Top banner and seal motif for institutional and corporate programmes.',
    suggestedAccent: '#1e3a5f',
    suggestedTitle: 'Certificate of Completion',
  },
  scholar: {
    key: 'scholar',
    name: 'Scholar',
    description: 'Hairline rules and academic proportions — understated and professional.',
    suggestedAccent: '#334155',
    suggestedTitle: 'Certificate of Distinction',
  },
};

export const CERTIFICATE_DESIGN_KEYS = Object.keys(CERTIFICATE_DESIGNS);

export function resolveCertificateDesign(key) {
  return CERTIFICATE_DESIGNS[key] ?? CERTIFICATE_DESIGNS.classic;
}
