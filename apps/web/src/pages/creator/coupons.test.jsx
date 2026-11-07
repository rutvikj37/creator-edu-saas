import { discountLabel, randomCode } from './CouponsPage.jsx';

it('labels capped percentage coupons', () => {
  expect(discountLabel({ type: 'PERCENT', value: '20', maxDiscountAmount: '500' }, 'INR')).toBe('20% off, up to ₹500.00');
  expect(discountLabel({ type: 'PERCENT', value: '20' }, 'INR')).toBe('20% off');
  expect(discountLabel({ type: 'FIXED', value: '100' }, 'INR')).toBe('₹100.00 off');
});

it('generates readable 8-character codes', () => {
  for (let i = 0; i < 50; i++) expect(randomCode()).toMatch(/^[A-HJ-KM-NP-Z2-9]{8}$/);
});
