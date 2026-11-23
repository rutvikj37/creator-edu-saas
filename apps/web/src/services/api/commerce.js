import { http } from './client.js';

const d = (r) => r.data;
const page = (r) => ({ items: r.data, meta: r.meta });
const blob = (r) => r.data;

export const creatorCommerceApi = {
  gateway: () => http.get('/creator/payments/razorpay').then(d),
  saveGateway: (body) => http.put('/creator/payments/razorpay', body).then(d),
  verifyGateway: () => http.post('/creator/payments/razorpay/verify').then(d),
  setGatewayActive: (isActive) => http.patch('/creator/payments/razorpay', { isActive }).then(d),
  removeGateway: () => http.delete('/creator/payments/razorpay').then(d),
  coupons: (q) => http.get('/creator/coupons', { params: q ? { q } : {} }).then(d),
  createCoupon: (body) => http.post('/creator/coupons', body).then(d),
  updateCoupon: (id, body) => http.patch(`/creator/coupons/${id}`, body).then(d),
  deleteCoupon: (id) => http.delete(`/creator/coupons/${id}`).then(d),
  orders: (params) => http.get('/creator/orders', { params }).then(page),
  recordOffline: (body) => http.post('/creator/orders/offline', body).then(d),
  comments: (id) => http.get(`/creator/orders/${id}/comments`).then(d),
  addComment: (id, body) => http.post(`/creator/orders/${id}/comments`, { body }).then(d),
  editOrder: (id, body) => http.patch(`/creator/orders/${id}`, body).then(d),
  settlements: (params) => http.get('/creator/settlements', { params }).then(d),
  settlementsCsv: (params) => http.get('/creator/settlements.csv', { params, responseType: 'blob' }).then(d),
  order: (id) => http.get(`/creator/orders/${id}`).then(d),
  summary: (params) => http.get('/creator/orders/summary', { params }).then(d),
  refund: (id, body) => http.post(`/creator/orders/${id}/refunds`, body).then(d),
  invoice: (id) => http.get(`/creator/orders/${id}/invoice`, { responseType: 'blob' }).then(blob),
  transactions: (params) => http.get('/creator/transactions', { params }).then(page),
};

export const checkoutApi = {
  quote: (body) => http.post('/learn/checkout/quote', body).then(d),
  offers: (courseId) => http.get('/learn/checkout/offers', { params: courseId ? { courseId } : {} }).then(d),
  checkout: (body, idempotencyKey) => http.post('/learn/checkout', body, { headers: { 'Idempotency-Key': idempotencyKey } }).then(d),
  orders: () => http.get('/learn/orders').then(d),
  order: (id) => http.get(`/learn/orders/${id}`).then(d),
  pay: (id) => http.post(`/learn/orders/${id}/pay`).then(d),
  confirm: (id, body) => http.post(`/learn/orders/${id}/confirm`, body).then(d),
  abandon: (id, reason) => http.post(`/learn/orders/${id}/abandon`, { reason }).then(d),
  invoice: (id) => http.get(`/learn/orders/${id}/invoice`, { responseType: 'blob' }).then(blob),
  upsell: (id) => http.get(`/learn/orders/${id}/upsell`).then(d),
  declineUpsell: (id, offerId) => http.post(`/learn/orders/${id}/upsell/${offerId}/decline`).then(d),
  paymentLink: (code) => http.get(`/public/pay/${encodeURIComponent(code)}`).then(d),
};

/** Academy sales funnels: order bumps, upsells, payment links, cart recovery, ad tracking. */
export const salesApi = {
  items: () => http.get('/creator/sales/items').then(d),
  offers: (type) => http.get('/creator/sales/offers', { params: type ? { type } : {} }).then(d),
  createOffer: (body) => http.post('/creator/sales/offers', body).then(d),
  updateOffer: (id, body) => http.put(`/creator/sales/offers/${id}`, body).then(d),
  offerStatus: (id, status) => http.post(`/creator/sales/offers/${id}/status`, { status }).then(d),
  deleteOffer: (id) => http.delete(`/creator/sales/offers/${id}`).then(d),
  links: () => http.get('/creator/sales/links').then(d),
  createLink: (body) => http.post('/creator/sales/links', body).then(d),
  updateLink: (id, body) => http.put(`/creator/sales/links/${id}`, body).then(d),
  deleteLink: (id) => http.delete(`/creator/sales/links/${id}`).then(d),
  recovery: () => http.get('/creator/sales/recovery').then(d),
  saveRecovery: (body) => http.put('/creator/sales/recovery', body).then(d),
  recoveryStats: () => http.get('/creator/sales/recovery/stats').then(d),
  recoveryRecent: () => http.get('/creator/sales/recovery/recent').then(d),
  tracking: () => http.get('/creator/sales/tracking').then(d),
  saveTracking: (body) => http.put('/creator/sales/tracking', body).then(d),
};

export const financeApi = {
  overview: (params) => http.get('/platform/finance/overview', { params }).then(d),
  transactions: (params) => http.get('/platform/finance/transactions', { params }).then(page),
  tax: (params) => http.get('/platform/finance/tax', { params }).then(d),
};

export const planBillingApi = {
  plans: () => http.get('/creator/billing/plans').then(d),
  quote: (planPriceId) => http.post('/creator/billing/quote', { planPriceId }).then(d),
  checkout: (planPriceId) => http.post('/creator/billing/checkout', { planPriceId }).then(d),
  invoices: () => http.get('/creator/billing/invoices').then(d),
  pay: (id) => http.post(`/creator/billing/invoices/${id}/pay`).then(d),
  confirm: (id, body) => http.post(`/creator/billing/invoices/${id}/confirm`, body).then(d),
  pdf: (id) => http.get(`/creator/billing/invoices/${id}/pdf`, { responseType: 'blob' }).then(blob),
  setCancel: (cancelAtPeriodEnd) => http.post('/creator/billing/cancellation', { cancelAtPeriodEnd }).then(d),
};

export const platformBillingApi = {
  gateway: (verify) => http.get('/platform/billing/gateway', { params: verify ? { verify: true } : {} }).then(d),
  subscriptions: (params) => http.get('/platform/billing/subscriptions', { params }).then(page),
  invoices: (params) => http.get('/platform/billing/invoices', { params }).then(page),
  pdf: (id) => http.get(`/platform/billing/invoices/${id}/pdf`, { responseType: 'blob' }).then(blob),
  recordPayment: (id, reference) => http.post(`/platform/billing/invoices/${id}/record-payment`, { reference }).then(d),
  void: (id, reason) => http.post(`/platform/billing/invoices/${id}/void`, { reason }).then(d),
};

export const bundlesApi = {
  list: () => http.get('/creator/bundles').then(d),
  get: (id) => http.get(`/creator/bundles/${id}`).then(d),
  create: (body) => http.post('/creator/bundles', body).then(d),
  update: (id, body) => http.patch(`/creator/bundles/${id}`, body).then(d),
  setStatus: (id, status) => http.post(`/creator/bundles/${id}/status`, { status }).then(d),
  publicList: () => http.get('/public/bundles').then(d),
  publicGet: (slug) => http.get(`/public/bundles/${slug}`).then(d),
};

export const cartApi = {
  get: () => http.get('/learn/cart').then(d),
  add: (body) => http.post('/learn/cart/items', body).then(d),
  remove: (id) => http.delete(`/learn/cart/items/${id}`).then(d),
  clear: () => http.delete('/learn/cart').then(d),
};

export const productsApi = {
  list: () => http.get('/creator/products').then(d),
  get: (id) => http.get(`/creator/products/${id}`).then(d),
  buyers: (id) => http.get(`/creator/products/${id}/buyers`).then(d),
  create: (body) => http.post('/creator/products', body).then(d),
  update: (id, body) => http.patch(`/creator/products/${id}`, body).then(d),
  setStatus: (id, status) => http.post(`/creator/products/${id}/status`, { status }).then(d),
  publicList: () => http.get('/public/products').then(d),
  publicGet: (slug) => http.get(`/public/products/${encodeURIComponent(slug)}`).then(d),
  mine: () => http.get('/learn/products').then(d),
  claim: (id) => http.post(`/learn/products/${id}/claim`).then(d),
  download: (id, fileId) => http.post(`/learn/products/${id}/files/${fileId}/download`).then(d),
};
