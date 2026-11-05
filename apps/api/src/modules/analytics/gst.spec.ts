import { csvCell, toCsv } from '../../common/csv/csv.js';
import { isInterState, splitTax } from './gst.js';

describe('GST place of supply', () => {
  const seller = { gstin: '24ABCDE1234F1Z5', state: 'Gujarat' };
  it('uses GSTIN state codes for B2B, even if the typed state disagrees', () => {
    expect(isInterState(seller, { gstin: '24AAACB1234C1Z5', state: 'Maharashtra' })).toBe(false);
    expect(isInterState(seller, { gstin: '27AAACB1234C1Z5', state: 'Gujarat' })).toBe(true);
  });
  it('compares state names loosely for B2C and treats an unknown location as intra-state', () => {
    expect(isInterState(seller, { state: ' gujarat ' })).toBe(false);
    expect(isInterState(seller, { state: 'Tamil Nadu' })).toBe(true);
    expect(isInterState(seller, {})).toBe(false);
    expect(isInterState({ state: null }, { state: 'Kerala' })).toBe(false);
  });
  it('splits CGST/SGST so the parts add up to the tax', () => {
    expect(splitTax(18001, false)).toEqual({ igst: 0, cgst: 9000, sgst: 9001 });
    expect(splitTax(18001, true)).toEqual({ igst: 18001, cgst: 0, sgst: 0 });
    expect(splitTax(-9001, false)).toEqual({ igst: 0, cgst: -4500, sgst: -4501 });
  });
});

describe('CSV', () => {
  it('quotes, neutralises formulas and keeps numbers numeric', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+91 98')).toBe("'+91 98");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['A', 'B'], [[1, 'x\ny']])).toBe('A,B\r\n1,"x\ny"');
  });
});
