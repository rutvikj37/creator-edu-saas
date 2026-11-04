/**
 * Transactional email templates. All interpolated values are HTML-escaped.
 * Phase 10 moves these into Super Admin–managed NotificationTemplate records.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function layout(brand: string, heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
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

export const emailTemplates = {
  verifyEmail(p: { brand: string; name: string; url: string; code: string }): RenderedEmail {
    return {
      subject: `Verify your email for ${p.brand}`,
      html: layout(p.brand, 'Confirm your email address', `<p>Hi ${escapeHtml(p.name)},</p><p>Confirm your email to secure your account. You can also enter this code: <strong style="font-size:18px;letter-spacing:2px">${escapeHtml(p.code)}</strong></p><p style="color:#64748b;font-size:13px">The link and code expire in 24 hours.</p>`, { label: 'Verify email', url: p.url }),
      text: `Hi ${p.name},\n\nVerify your email: ${p.url}\nOr enter code ${p.code}. Expires in 24 hours.`,
    };
  },
  passwordReset(p: { brand: string; name: string; url: string }): RenderedEmail {
    return {
      subject: `Reset your ${p.brand} password`,
      html: layout(p.brand, 'Reset your password', `<p>Hi ${escapeHtml(p.name)},</p><p>We received a request to reset your password. This link expires in 30 minutes. If you didn't ask for this, you can ignore this email.</p>`, { label: 'Reset password', url: p.url }),
      text: `Hi ${p.name},\n\nReset your password: ${p.url}\nThis link expires in 30 minutes. Ignore this email if you didn't request it.`,
    };
  },
  otp(p: { brand: string; code: string; purpose: string }): RenderedEmail {
    return {
      subject: `${p.code} is your ${p.brand} code`,
      html: layout(p.brand, 'Your verification code', `<p>Use this code to ${escapeHtml(p.purpose)}:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(p.code)}</p><p style="color:#64748b;font-size:13px">It expires in 10 minutes. Never share it with anyone.</p>`),
      text: `Your ${p.brand} code is ${p.code}. It expires in 10 minutes.`,
    };
  },
  passwordChanged(p: { brand: string; name: string }): RenderedEmail {
    return {
      subject: `Your ${p.brand} password was changed`,
      html: layout(p.brand, 'Password changed', `<p>Hi ${escapeHtml(p.name)},</p><p>Your password was just changed and other devices were signed out. If this wasn't you, reset your password immediately and contact support.</p>`),
      text: `Hi ${p.name}, your password was changed and other devices were signed out. If this wasn't you, reset your password immediately.`,
    };
  },
};
