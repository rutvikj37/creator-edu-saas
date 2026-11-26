import { CERTIFICATE_DESIGN_KEYS, resolveCertificateDesign } from '@ce/shared';
import { certificateNumber } from './certificates.service.js';
import { renderCertificatePdf } from './certificate-pdf.js';

describe('certificateNumber', () => {
  it('is well-formed, unambiguous and unique enough', () => {
    const n = certificateNumber(2026);
    expect(n).toMatch(/^CE-2026-[A-HJ-NP-Z2-9]{8}$/);
    expect(new Set(Array.from({ length: 2000 }, () => certificateNumber())).size).toBe(2000);
  });
});

describe('certificate designs', () => {
  it('resolves unknown keys to classic', () => {
    expect(resolveCertificateDesign('nope').key).toBe('classic');
    expect(CERTIFICATE_DESIGN_KEYS.length).toBeGreaterThanOrEqual(4);
  });

  it.each([...CERTIFICATE_DESIGN_KEYS])('renders a PDF for %s', async (designKey) => {
    const { bytes, fileName } = await renderCertificatePdf({
      designKey,
      title: 'Certificate of Completion',
      bodyText: 'has successfully completed',
      signatoryName: 'Ada Lovelace',
      signatoryRole: 'Director',
      accentColor: '#0f766e',
      showQr: false,
      academyName: 'TechX Academy',
      recipientName: 'Alex Student',
      courseTitle: 'Intro to LMS',
      number: 'CE-2026-TEST0001',
      issuedAt: new Date('2026-11-26T00:00:00Z'),
      verifyUrl: 'https://example.com/verify/CE-2026-TEST0001',
    });
    expect(fileName).toBe('certificate-CE-2026-TEST0001.pdf');
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
