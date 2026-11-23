/**
 * Transactional emails whose wording Super Admin can change (EmailTemplateOverride).
 * Content is plain text with {{variable}} placeholders: blank lines separate paragraphs,
 * a paragraph of "- " lines becomes a list and **text** is bold. Values are always HTML-escaped.
 */
export interface TemplateContent {
  subject: string;
  heading: string;
  body: string;
  ctaLabel?: string | null;
}

export interface TemplateVariable {
  name: string;
  description: string;
  sample: string;
}

export interface EditableTemplate {
  key: string;
  name: string;
  description: string;
  variables: TemplateVariable[];
  /** Placeholders the body must keep, e.g. the one-time code. */
  required: string[];
  /** Variable holding the button URL; the button is omitted without one. */
  ctaVar?: string;
  defaults: TemplateContent;
}

const brand: TemplateVariable = { name: 'brand', description: 'Academy or platform name', sample: 'Acme Academy' };
const name: TemplateVariable = { name: 'name', description: 'Recipient’s full name', sample: 'Priya Sharma' };

export const EDITABLE_TEMPLATES: EditableTemplate[] = [
  {
    key: 'verifyEmail', name: 'Verify email', description: 'Sent after sign-up to confirm the email address.',
    variables: [brand, name, { name: 'code', description: 'Six-digit verification code', sample: '482913' }, { name: 'url', description: 'Verification link', sample: 'https://acme.example.com/verify-email?token=abc' }],
    required: ['code'], ctaVar: 'url',
    defaults: {
      subject: 'Verify your email for {{brand}}', heading: 'Confirm your email address', ctaLabel: 'Verify email',
      body: 'Hi {{name}},\n\nConfirm your email to secure your account. You can also enter this code:\n\n**{{code}}**\n\nThe link and code expire in 24 hours.',
    },
  },
  {
    key: 'otp', name: 'One-time code', description: 'Sign-in and verification codes sent by email.',
    variables: [brand, { name: 'code', description: 'Six-digit code', sample: '771204' }, { name: 'purpose', description: 'What the code is for', sample: 'verify your email' }],
    required: ['code'],
    defaults: {
      subject: '{{code}} is your {{brand}} code', heading: 'Your verification code',
      body: 'Use this code to {{purpose}}:\n\n**{{code}}**\n\nIt expires in 10 minutes. Never share it with anyone.',
    },
  },
  {
    key: 'passwordReset', name: 'Password reset', description: 'Sent when someone asks to reset their password.',
    variables: [brand, name, { name: 'url', description: 'Reset link (valid 30 minutes)', sample: 'https://acme.example.com/reset-password?token=abc' }],
    required: [], ctaVar: 'url',
    defaults: {
      subject: 'Reset your {{brand}} password', heading: 'Reset your password', ctaLabel: 'Reset password',
      body: 'Hi {{name}},\n\nWe received a request to reset your password. This link expires in 30 minutes. If you didn’t ask for this, you can ignore this email.',
    },
  },
  {
    key: 'passwordChanged', name: 'Password changed', description: 'Security notice after a password change.',
    variables: [brand, name], required: [],
    defaults: {
      subject: 'Your {{brand}} password was changed', heading: 'Password changed',
      body: 'Hi {{name}},\n\nYour password was just changed and other devices were signed out. If this wasn’t you, reset your password immediately and contact support.',
    },
  },
  {
    key: 'purchaseReceipt', name: 'Purchase receipt', description: 'Sent to a student after a successful payment.',
    variables: [brand, name, { name: 'orderNumber', description: 'Order number', sample: 'ORD-000042' }, { name: 'items', description: 'Purchased items, one "- item" per line', sample: '- Python for Beginners\n- Interview Prep Bundle' }, { name: 'total', description: 'Amount paid', sample: '₹2,499.00' }, { name: 'url', description: 'Link to the student’s learning area', sample: 'https://acme.example.com/learn' }],
    required: [], ctaVar: 'url',
    defaults: {
      subject: 'Payment received — order {{orderNumber}}', heading: 'Thanks for your purchase', ctaLabel: 'Start learning',
      body: 'Hi {{name}},\n\nWe received your payment of **{{total}}** for order {{orderNumber}}. You now have access to:\n\n{{items}}\n\nYour invoice is available in your order history.',
    },
  },
  {
    key: 'refundIssued', name: 'Refund issued', description: 'Sent when an order is refunded.',
    variables: [brand, name, { name: 'orderNumber', description: 'Order number', sample: 'ORD-000042' }, { name: 'amount', description: 'Refunded amount', sample: '₹2,499.00' }, { name: 'access', description: 'Whether course access continues', sample: 'Access to the purchased course has ended.' }],
    required: [],
    defaults: {
      subject: 'Refund processed — order {{orderNumber}}', heading: 'Your refund is on its way',
      body: 'Hi {{name}},\n\nA refund of **{{amount}}** for order {{orderNumber}} has been processed. Banks usually take 5–7 working days to show it.\n\n{{access}}',
    },
  },
  {
    key: 'checkoutRecovery', name: 'Abandoned checkout reminder', description: 'Sent by an academy’s cart recovery when a student leaves checkout without paying.',
    variables: [brand, name, { name: 'items', description: 'Items left at checkout, one "- item" per line', sample: '- Python for Beginners' }, { name: 'total', description: 'Order total', sample: '₹2,499.00' }, { name: 'offer', description: 'Discount line when the academy adds a recovery coupon (empty otherwise)', sample: 'Use code COMEBACK10 to get 10% off.' }, { name: 'url', description: 'Link back to checkout', sample: 'https://acme.example.com/checkout/course/python' }],
    required: [], ctaVar: 'url',
    defaults: {
      subject: 'You left something at checkout', heading: 'Still thinking it over?', ctaLabel: 'Complete my purchase',
      body: 'Hi {{name}},\n\nYou started checking out but didn’t finish:\n\n{{items}}\n\nTotal: **{{total}}**\n\n{{offer}}\n\nYour place is saved — pick up right where you left off.',
    },
  },
];

export const editableTemplate = (key: string) => EDITABLE_TEMPLATES.find((t) => t.key === key);

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

/** Placeholders used in the content that the template does not provide. */
export function unknownPlaceholders(content: TemplateContent, tpl: EditableTemplate): string[] {
  const known = new Set(tpl.variables.map((v) => v.name));
  const used = [content.subject, content.heading, content.body].join('\n').matchAll(/\{\{\s*(\w+)\s*\}\}/g);
  return [...new Set([...used].map((m) => m[1]).filter((k) => !known.has(k)))];
}

export function missingRequired(content: TemplateContent, tpl: EditableTemplate): string[] {
  return tpl.required.filter((r) => !new RegExp(`\\{\\{\\s*${r}\\s*\\}\\}`).test(content.body));
}

const bold = (escaped: string) => escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

function paragraphHtml(p: string): string {
  const lines = p.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.every((l) => l.startsWith('- '))) return `<ul>${lines.map((l) => `<li>${bold(escapeHtml(l.slice(2)))}</li>`).join('')}</ul>`;
  const solo = /^\*\*([^*]+)\*\*$/.exec(lines.join(' '));
  if (lines.length === 1 && solo) return `<p style="font-size:26px;font-weight:700;letter-spacing:4px;margin:16px 0">${escapeHtml(solo[1])}</p>`;
  return `<p>${lines.map((l) => bold(escapeHtml(l))).join('<br>')}</p>`;
}

export function layout(brand: string, heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${escapeHtml(cta.url)}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p>
       <p style="font-size:12px;color:#64748b">If the button doesn't work, copy this link:<br><span style="word-break:break-all">${escapeHtml(cta.url)}</span></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <p style="font-weight:700;font-size:16px;margin:0 0 24px">${escapeHtml(brand)}</p>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
      <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(heading)}</h1>
      ${bodyHtml}${button}
    </div>
    <p style="font-size:12px;color:#94a3b8;margin-top:20px">You received this email because of activity on your ${escapeHtml(brand)} account.</p>
  </div></body></html>`;
}

/** Renders editable content with the given values. Values never become markup. */
export function renderContent(tpl: EditableTemplate, content: TemplateContent, vars: Record<string, string>) {
  const oneLine = (s: string) => interpolate(s, vars).replace(/\s+/g, ' ').trim();
  const paragraphs = interpolate(content.body.replace(/\r\n/g, '\n'), vars).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const url = tpl.ctaVar ? vars[tpl.ctaVar] : undefined;
  const label = content.ctaLabel?.trim() || tpl.defaults.ctaLabel || 'Open';
  const cta = url ? { label: oneLine(label), url } : undefined;
  const heading = oneLine(content.heading);
  return {
    subject: oneLine(content.subject).slice(0, 200),
    html: layout(vars.brand ?? '', heading, paragraphs.map(paragraphHtml).join(''), cta),
    text: `${paragraphs.map((p) => p.replace(/\*\*(.+?)\*\*/g, '$1')).join('\n\n')}${cta ? `\n\n${cta.label}: ${cta.url}` : ''}`,
  };
}

export function sampleVars(tpl: EditableTemplate): Record<string, string> {
  return Object.fromEntries(tpl.variables.map((v) => [v.name, v.sample]));
}
