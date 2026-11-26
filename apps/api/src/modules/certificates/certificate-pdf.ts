import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import QRCode from 'qrcode';
import { resolveCertificateDesign } from '@ce/shared';

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Standard PDF fonts only encode WinAnsi; replace characters they can't draw. */
export function pdfSafe(text: string) {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
}

export type CertPdfInput = {
  designKey: string;
  title: string;
  bodyText: string;
  signatoryName: string | null;
  signatoryRole: string | null;
  accentColor: string;
  showQr: boolean;
  academyName: string;
  recipientName: string;
  courseTitle: string;
  number: string;
  issuedAt: Date;
  verifyUrl: string;
};

type DrawCtx = {
  page: PDFPage;
  width: number;
  height: number;
  accent: RGB;
  muted: RGB;
  ink: RGB;
  serif: PDFFont;
  sans: PDFFont;
  sansBold: PDFFont;
  center: (text: string, y: number, size: number, font?: PDFFont, color?: RGB) => void;
};

function makeCenter(page: PDFPage, width: number, sans: PDFFont): DrawCtx['center'] {
  return (text, y, size, font = sans, color = rgb(0.15, 0.18, 0.25)) => {
    const s = pdfSafe(text);
    page.drawText(s, { x: (width - font.widthOfTextAtSize(s, size)) / 2, y, size, font, color });
  };
}

function drawCorners(page: PDFPage, accent: RGB, inset: number, arm: number) {
  const { width, height } = page.getSize();
  const corners: Array<[number, number, number, number]> = [
    [inset, height - inset, inset + arm, height - inset],
    [inset, height - inset, inset, height - inset - arm],
    [width - inset, height - inset, width - inset - arm, height - inset],
    [width - inset, height - inset, width - inset, height - inset - arm],
    [inset, inset, inset + arm, inset],
    [inset, inset, inset, inset + arm],
    [width - inset, inset, width - inset - arm, inset],
    [width - inset, inset, width - inset, inset + arm],
  ];
  for (const [x1, y1, x2, y2] of corners) {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1.5, color: accent });
  }
}

function drawFooter(ctx: DrawCtx, c: CertPdfInput) {
  const { page, width, sans, sansBold, muted } = ctx;
  page.drawText(pdfSafe(`Certificate no. ${c.number}`), { x: 60, y: 48, size: 9, font: sans, color: muted });
  if (c.signatoryName) {
    page.drawLine({ start: { x: width - 290, y: 110 }, end: { x: width - 110, y: 110 }, thickness: 0.75, color: muted });
    page.drawText(pdfSafe(c.signatoryName), { x: width - 290, y: 94, size: 11, font: sansBold });
    if (c.signatoryRole) page.drawText(pdfSafe(c.signatoryRole), { x: width - 290, y: 80, size: 9, font: sans, color: muted });
  }
}

async function drawQr(ctx: DrawCtx, doc: PDFDocument, verifyUrl: string, show: boolean, x = 60, y = 80) {
  if (!show) return;
  const png = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 240 });
  const img = await doc.embedPng(png);
  ctx.page.drawImage(img, { x, y, width: 72, height: 72 });
  ctx.page.drawText('Scan to verify', { x: x + 2, y: y + 78, size: 8, font: ctx.sans, color: ctx.muted });
}

function layoutClassic(ctx: DrawCtx, c: CertPdfInput) {
  const { page, width, height, accent, center, serif, sansBold } = ctx;
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: accent, borderWidth: 3 });
  page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderColor: accent, borderWidth: 0.75, opacity: 0.6 });
  center(c.academyName.toUpperCase(), height - 100, 14, sansBold, accent);
  center(c.title, height - 160, 34, serif);
  center('This is to certify that', height - 210, 13);
  center(c.recipientName, height - 260, 30, serif, accent);
  center(c.bodyText, height - 300, 13);
  center(c.courseTitle, height - 335, 18, sansBold);
  center(`Issued on ${c.issuedAt.toISOString().slice(0, 10)}`, height - 370, 11);
  drawFooter(ctx, c);
}

function layoutElegant(ctx: DrawCtx, c: CertPdfInput) {
  const { page, width, height, accent, center, serif, sans, sansBold, muted } = ctx;
  page.drawRectangle({ x: 28, y: 28, width: width - 56, height: height - 56, borderColor: accent, borderWidth: 1.25 });
  drawCorners(page, accent, 42, 28);
  center(c.academyName.toUpperCase(), height - 88, 12, sansBold, muted);
  page.drawLine({ start: { x: width / 2 - 60, y: height - 108 }, end: { x: width / 2 + 60, y: height - 108 }, thickness: 0.6, color: accent });
  center(c.title, height - 150, 32, serif, accent);
  center('This is to certify that', height - 200, 12);
  center(c.recipientName, height - 250, 28, serif);
  center(c.bodyText, height - 290, 12);
  center(c.courseTitle, height - 325, 16, sansBold, accent);
  center(`Issued on ${c.issuedAt.toISOString().slice(0, 10)}`, height - 360, 10, sans, muted);
  drawFooter(ctx, c);
}

function layoutModern(ctx: DrawCtx, c: CertPdfInput) {
  const { page, height, accent, serif, sans, sansBold, muted, ink } = ctx;
  page.drawRectangle({ x: 0, y: 0, width: 18, height, color: accent });
  page.drawRectangle({ x: 18, y: 0, width: 6, height, color: accent, opacity: 0.25 });
  const left = 56;
  page.drawText(pdfSafe(c.academyName.toUpperCase()), { x: left, y: height - 72, size: 11, font: sansBold, color: accent });
  page.drawText(pdfSafe(c.title), { x: left, y: height - 130, size: 30, font: serif, color: ink });
  page.drawRectangle({ x: left, y: height - 148, width: 72, height: 3, color: accent });
  page.drawText(pdfSafe('This is to certify that'), { x: left, y: height - 190, size: 12, font: sans, color: muted });
  page.drawText(pdfSafe(c.recipientName), { x: left, y: height - 240, size: 26, font: serif, color: accent });
  page.drawText(pdfSafe(c.bodyText), { x: left, y: height - 280, size: 12, font: sans, color: muted });
  page.drawText(pdfSafe(c.courseTitle), { x: left, y: height - 315, size: 16, font: sansBold, color: ink });
  page.drawText(pdfSafe(`Issued on ${c.issuedAt.toISOString().slice(0, 10)}`), { x: left, y: height - 350, size: 10, font: sans, color: muted });
  drawFooter(ctx, c);
}

function layoutFormal(ctx: DrawCtx, c: CertPdfInput) {
  const { page, width, height, accent, center, serif, sans, sansBold, muted } = ctx;
  page.drawRectangle({ x: 0, y: height - 88, width, height: 88, color: accent });
  center(c.academyName.toUpperCase(), height - 52, 16, sansBold, rgb(1, 1, 1));
  page.drawCircle({ x: width / 2, y: height - 130, size: 22, borderColor: accent, borderWidth: 2 });
  page.drawCircle({ x: width / 2, y: height - 130, size: 14, borderColor: accent, borderWidth: 1 });
  center(c.title, height - 185, 28, serif);
  center('This is to certify that', height - 230, 12);
  center(c.recipientName, height - 275, 26, serif, accent);
  center(c.bodyText, height - 310, 12);
  center(c.courseTitle, height - 345, 16, sansBold);
  center(`Issued on ${c.issuedAt.toISOString().slice(0, 10)}`, height - 375, 10, sans, muted);
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: accent, borderWidth: 1.5 });
  drawFooter(ctx, c);
}

function layoutScholar(ctx: DrawCtx, c: CertPdfInput) {
  const { page, width, height, accent, center, serif, sans, sansBold, muted } = ctx;
  const rule = (y: number) => page.drawLine({ start: { x: 100, y }, end: { x: width - 100, y }, thickness: 0.75, color: accent });
  rule(height - 70);
  rule(height - 76);
  center(c.academyName.toUpperCase(), height - 105, 12, sansBold, muted);
  center(c.title, height - 155, 30, serif);
  rule(height - 175);
  center('This is to certify that', height - 215, 12);
  center(c.recipientName, height - 260, 26, serif, accent);
  center(c.bodyText, height - 300, 12);
  center(c.courseTitle, height - 335, 16, sansBold);
  center(`Issued on ${c.issuedAt.toISOString().slice(0, 10)}`, height - 365, 10, sans, muted);
  rule(70);
  rule(64);
  drawFooter(ctx, c);
}

export async function renderCertificatePdf(c: CertPdfInput): Promise<{ bytes: Uint8Array; fileName: string }> {
  const design = resolveCertificateDesign(c.designKey).key;
  const doc = await PDFDocument.create();
  doc.setTitle(`${c.title} — ${c.recipientName}`);
  doc.setAuthor(c.academyName);
  const page = doc.addPage([842, 595]); // A4 landscape
  const { width, height } = page.getSize();
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = hexToRgb(c.accentColor);
  const ctx: DrawCtx = {
    page,
    width,
    height,
    accent,
    muted: rgb(0.4, 0.45, 0.5),
    ink: rgb(0.15, 0.18, 0.25),
    serif,
    sans,
    sansBold,
    center: makeCenter(page, width, sans),
  };
  switch (design) {
    case 'elegant':
      layoutElegant(ctx, c);
      break;
    case 'modern':
      layoutModern(ctx, c);
      break;
    case 'formal':
      layoutFormal(ctx, c);
      break;
    case 'scholar':
      layoutScholar(ctx, c);
      break;
    default:
      layoutClassic(ctx, c);
  }
  await drawQr(ctx, doc, c.verifyUrl, c.showQr);
  return { bytes: await doc.save(), fileName: `certificate-${c.number}.pdf` };
}
