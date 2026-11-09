/**
 * Transactional email templates. All interpolated values are HTML-escaped.
 * Templates listed in EDITABLE_TEMPLATES can be reworded by Super Admin; MailService applies the override.
 */
import { editableTemplate, escapeHtml, layout, renderContent } from './editable-templates.js';

export { escapeHtml };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Set for editable templates so a Super Admin override can re-render the email. */
  template?: { key: string; vars: Record<string, string> };
}

function fromTemplate(key: string, vars: Record<string, string>): RenderedEmail {
  const tpl = editableTemplate(key)!;
  return { ...renderContent(tpl, tpl.defaults, vars), template: { key, vars } };
}

export const emailTemplates = {
  /** Marketing email: trusted HTML from richTextToHtml plus the legally required footer. */
  campaign(p: { brand: string; subject: string; previewText?: string | null; bodyHtml: string; bodyText: string; unsubscribeUrl: string; address?: string | null }): RenderedEmail {
    const preheader = p.previewText ? `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(p.previewText)}</div>` : '';
    const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a">${preheader}
  <div style="max-width:600px;margin:0 auto;padding:32px 20px">
    <p style="font-weight:700;font-size:16px;margin:0 0 24px">${escapeHtml(p.brand)}</p>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;line-height:1.6">${p.bodyHtml}</div>
    <p style="font-size:12px;color:#94a3b8;margin-top:20px">You're receiving this because you agreed to hear from ${escapeHtml(p.brand)}.${p.address ? ` ${escapeHtml(p.address)}.` : ''}<br><a href="${escapeHtml(p.unsubscribeUrl)}" style="color:#64748b">Unsubscribe</a></p>
  </div></body></html>`;
    return { subject: p.subject, html, text: `${p.bodyText}\n\n—\nYou're receiving this because you agreed to hear from ${p.brand}. Unsubscribe: ${p.unsubscribeUrl}` };
  },
  verifyEmail(p: { brand: string; name: string; url: string; code: string }): RenderedEmail {
    return fromTemplate('verifyEmail', p);
  },
  purchaseReceipt(p: { brand: string; name: string; orderNumber: string; items: string[]; total: string; url: string }): RenderedEmail {
    return fromTemplate('purchaseReceipt', { ...p, items: p.items.map((i) => `- ${i}`).join('\n') });
  },
  refundIssued(p: { brand: string; name: string; orderNumber: string; amount: string; accessRevoked: boolean }): RenderedEmail {
    const access = p.accessRevoked ? 'Access to the purchased course has ended.' : 'Your course access is unchanged.';
    return fromTemplate('refundIssued', { brand: p.brand, name: p.name, orderNumber: p.orderNumber, amount: p.amount, access });
  },
  checkoutRecovery(p: { brand: string; name: string; items: string[]; total: string; offer?: string | null; url: string }): RenderedEmail {
    return fromTemplate('checkoutRecovery', { ...p, items: p.items.map((i) => `- ${i}`).join('\n'), offer: p.offer ?? '' });
  },
  /** Plan billing notices (invoice ready, reminder, past due, expired, receipt, trial ending). */
  billingNotice(p: { brand: string; subject: string; heading: string; lines: string[]; cta?: { label: string; url: string } }): RenderedEmail {
    return {
      subject: p.subject,
      html: layout(p.brand, p.heading, p.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(''), p.cta),
      text: `${p.lines.join('\n\n')}${p.cta ? `\n\n${p.cta.label}: ${p.cta.url}` : ''}`,
    };
  },
  passwordReset(p: { brand: string; name: string; url: string }): RenderedEmail {
    return fromTemplate('passwordReset', p);
  },
  otp(p: { brand: string; code: string; purpose: string }): RenderedEmail {
    return fromTemplate('otp', p);
  },
  passwordChanged(p: { brand: string; name: string }): RenderedEmail {
    return fromTemplate('passwordChanged', p);
  },
};
