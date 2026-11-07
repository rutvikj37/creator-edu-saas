/** Calling codes for the country picker on phone fields (most common first, then A–Z). */
const DIAL = {
  IN: '91', US: '1', GB: '44', AE: '971', SA: '966', SG: '65', AU: '61', CA: '1', NP: '977', BD: '880', LK: '94', PK: '92',
  AF: '93', AR: '54', AT: '43', BE: '32', BH: '973', BR: '55', BT: '975', CH: '41', CN: '86', CO: '57', CZ: '420', DE: '49', DK: '45',
  EG: '20', ES: '34', ET: '251', FI: '358', FR: '33', GH: '233', GR: '30', HK: '852', HU: '36', ID: '62', IE: '353', IL: '972', IQ: '964',
  IT: '39', JP: '81', JO: '962', KE: '254', KR: '82', KW: '965', LB: '961', MM: '95', MU: '230', MV: '960', MX: '52', MY: '60', NG: '234',
  NL: '31', NO: '47', NZ: '64', OM: '968', PH: '63', PL: '48', PT: '351', QA: '974', RO: '40', RU: '7', SE: '46', TH: '66', TR: '90',
  TZ: '255', UA: '380', UG: '256', VN: '84', ZA: '27',
};

/** Flag emoji from an ISO 3166-1 alpha-2 code. */
export const flag = (iso) => String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export const DIAL_CODES = Object.entries(DIAL).map(([iso, code]) => ({ iso, code }));

/** "+91" + "98765 43210" → "+919876543210" (spaces, dashes and brackets removed); empty number → "". */
export function joinPhone(code, number) {
  const digits = (number ?? '').replace(/[\s\-().]/g, '');
  if (!digits) return '';
  return digits.startsWith('+') ? digits : `+${code}${digits.replace(/^0+/, '')}`;
}
