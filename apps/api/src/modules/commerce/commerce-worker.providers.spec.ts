import { AccountCredentialsService } from '../auth/services/account-credentials.service.js';
import { PasswordService } from '../auth/services/password.service.js';
import { COMMERCE_WORKER_PROVIDERS } from './commerce.module.js';
import { OrdersService } from './orders.service.js';

/** Guards the DI set that boots lms-worker — a missing provider stalls every transactional email. */
describe('CommerceWorkerModule providers', () => {
  it('includes AccountCredentialsService and PasswordService for OrdersService', () => {
    expect(COMMERCE_WORKER_PROVIDERS).toContain(OrdersService);
    expect(COMMERCE_WORKER_PROVIDERS).toContain(AccountCredentialsService);
    expect(COMMERCE_WORKER_PROVIDERS).toContain(PasswordService);
  });
});
