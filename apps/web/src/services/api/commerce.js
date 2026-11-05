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
  order: (id) => http.get(`/creator/orders/${id}`).then(d),
  summary: (params) => http.get('/creator/orders/summary', { params }).then(d),
  refund: (id, body) => http.post(`/creator/orders/${id}/refunds`, body).then(d),
  invoice: (id) => http.get(`/creator/orders/${id}/invoice`, { responseType: 'blob' }).then(blob),
  transactions: (params) => http.get('/creator/transactions', { params }).then(page),
};

export const checkoutApi = {
  quote: (body) => http.post('/learn/checkout/quote', body).then(d),
  checkout: (body, idempotencyKey) => http.post('/learn/checkout', body, { headers: { 'Idempotency-Key': idempotencyKey } }).then(d),
  orders: () => http.get('/learn/orders').then(d),
  order: (id) => http.get(`/learn/orders/${id}`).then(d),
  pay: (id) => http.post(`/learn/orders/${id}/pay`).then(d),
  confirm: (id, body) => http.post(`/learn/orders/${id}/confirm`, body).then(d),
  abandon: (id, reason) => http.post(`/learn/orders/${id}/abandon`, { reason }).then(d),
  invoice: (id) => http.get(`/learn/orders/${id}/invoice`, { responseType: 'blob' }).then(blob),
};

export const financeApi = {
  overview: (params) => http.get('/platform/finance/overview', { params }).then(d),
  transactions: (params) => http.get('/platform/finance/transactions', { params }).then(page),
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
