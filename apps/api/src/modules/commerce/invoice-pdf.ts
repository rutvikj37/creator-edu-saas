import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

interface InvoiceData {
  number: string;
  issuedAt: Date;
  orderNumber: string;
  seller: { name: string; address?: string; gstin?: string | null; pan?: string | null; details?: string | null; note?: string | null };
  buyer: { name?: string | null; email?: string | null; phone?: string | null; state?: string | null; gstin?: string | null };
  lines: { description: string; quantity: number; unitAmount: string; discountAmount: string; totalAmount: string }[];
  totals: { currency: string; subtotal: string; discount: string; tax: string; taxRate: string | null; taxInclusive: boolean; total: string; zeroRated?: boolean; paidVia: string; paymentId: string | null };
  refunded?: string | null;
}

/** Standard PDF fonts are WinAnsi-only: replace characters they cannot encode. */
const safe = (s: string) => s.replace(/₹/g, 'Rs.').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
const money = (v: string, c: string) => `${c} ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function renderInvoicePdf(inv: InvoiceData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${inv.number}`);
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.16);
  const muted = rgb(0.42, 0.45, 0.5);
  const text = (p: PDFPage, s: string, x: number, y: number, f: PDFFont = font, size = 10, color = ink) => p.drawText(safe(s), { x, y, font: f, size, color });
  const right = (p: PDFPage, s: string, xr: number, y: number, f: PDFFont = font, size = 10) => text(p, s, xr - f.widthOfTextAtSize(safe(s), size), y, f, size);
  const wrap = (s: string, width: number, f = font, size = 10) => {
    const words = safe(s).split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = w; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  const L = 50;
  const R = 545;
  let y = 790;
  text(page, inv.totals.tax !== '0' && inv.seller.gstin ? 'TAX INVOICE' : 'INVOICE', L, y, bold, 18);
  right(page, inv.number, R, y + 4, bold, 11);
  right(page, `Date: ${inv.issuedAt.toISOString().slice(0, 10)}`, R, y - 12, font, 9);
  right(page, `Order: ${inv.orderNumber}`, R, y - 24, font, 9);

  y -= 60;
  text(page, 'From', L, y, bold, 9, muted);
  text(page, 'Billed to', 310, y, bold, 9, muted);
  y -= 15;
  const sellerLines = [inv.seller.name, ...(inv.seller.address ? wrap(inv.seller.address, 230) : []), inv.seller.gstin ? `GSTIN: ${inv.seller.gstin}` : '', inv.seller.pan ? `PAN: ${inv.seller.pan}` : ''].filter(Boolean);
  const buyerLines = [inv.buyer.name ?? '', inv.buyer.email ?? '', inv.buyer.phone ?? '', inv.buyer.state ? `State: ${inv.buyer.state}` : '', inv.buyer.gstin ? `GSTIN: ${inv.buyer.gstin}` : ''].filter(Boolean);
  for (let i = 0; i < Math.max(sellerLines.length, buyerLines.length); i++) {
    if (sellerLines[i]) text(page, sellerLines[i], L, y, i === 0 ? bold : font);
    if (buyerLines[i]) text(page, buyerLines[i], 310, y, i === 0 ? bold : font);
    y -= 14;
  }

  y -= 20;
  page.drawRectangle({ x: L, y: y - 6, width: R - L, height: 22, color: rgb(0.95, 0.96, 0.97) });
  text(page, 'Description', L + 8, y, bold, 9);
  right(page, 'Price', 370, y, bold, 9);
  right(page, 'Discount', 455, y, bold, 9);
  right(page, 'Amount', R - 8, y, bold, 9);
  y -= 24;
  const c = inv.totals.currency;
  for (const l of inv.lines) {
    const desc = wrap(l.description, 230);
    desc.forEach((d, i) => text(page, d, L + 8, y - i * 13));
    right(page, money(l.unitAmount, c), 370, y);
    right(page, Number(l.discountAmount) ? `-${money(l.discountAmount, c)}` : '-', 455, y);
    right(page, money(l.totalAmount, c), R - 8, y);
    y -= 13 * desc.length + 10;
  }
  page.drawLine({ start: { x: L, y: y + 4 }, end: { x: R, y: y + 4 }, thickness: 0.5, color: rgb(0.85, 0.86, 0.88) });

  y -= 14;
  const row = (label: string, value: string, f = font) => { right(page, label, 440, y, f); right(page, value, R - 8, y, f); y -= 16; };
  row('Subtotal', money(inv.totals.subtotal, c));
  if (Number(inv.totals.discount)) row('Discount', `-${money(inv.totals.discount, c)}`);
  if (Number(inv.totals.tax)) row(`GST ${inv.totals.taxRate ?? ''}%${inv.totals.taxInclusive ? ' (included)' : ''}`, money(inv.totals.tax, c));
  if (inv.totals.zeroRated) row('IGST 0% (export under LUT)', money('0', c));
  row('Total paid', money(inv.totals.total, c), bold);
  if (inv.refunded && Number(inv.refunded)) row('Refunded', `-${money(inv.refunded, c)}`);

  y -= 20;
  text(page, `Paid via ${inv.totals.paidVia}${inv.totals.paymentId ? ` · Payment ID ${inv.totals.paymentId}` : ''}`, L, y, font, 9, muted);
  for (const [label, body] of [['Tax details', inv.seller.details], ['Note', inv.seller.note]] as const) {
    if (!body) continue;
    y -= 22;
    text(page, label, L, y, bold, 9);
    for (const para of body.split(/\r?\n/)) for (const l of wrap(para, 495)) { y -= 12; if (y < 80) break; text(page, l, L, y, font, 9, muted); }
  }
  text(page, 'This is a computer-generated invoice and does not require a signature.', L, 60, font, 8, muted);
  return Buffer.from(await doc.save());
}
