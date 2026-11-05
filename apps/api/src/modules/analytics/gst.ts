/**
 * GST split for an Indian supply of services. Inter-state supplies carry IGST; intra-state supplies
 * carry CGST + SGST in equal halves. Place of supply:
 *  - B2B (buyer has a GSTIN): the buyer's state, i.e. the GSTIN's 2-digit state code, compared with
 *    the seller's GSTIN state code;
 *  - B2C: the buyer's state as entered at checkout, compared by name with the seller's state;
 *  - unknown buyer location: the supplier's location (IGST Act s.12(2)(b)) → intra-state.
 */
export interface GstParty { gstin?: string | null; state?: string | null }

const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');

export function isInterState(seller: GstParty, buyer: GstParty): boolean {
  const sCode = seller.gstin?.slice(0, 2);
  const bCode = buyer.gstin?.slice(0, 2);
  if (sCode && bCode && /^\d{2}$/.test(sCode) && /^\d{2}$/.test(bCode)) return sCode !== bCode;
  if (norm(seller.state) && norm(buyer.state)) return norm(seller.state) !== norm(buyer.state);
  return false;
}

/** Splits a tax amount in minor units; odd paise go to SGST so the parts always add up. */
export function splitTax(taxMinor: number, interState: boolean) {
  if (interState) return { igst: taxMinor, cgst: 0, sgst: 0 };
  const cgst = Math.trunc(taxMinor / 2);
  return { igst: 0, cgst, sgst: taxMinor - cgst };
}
