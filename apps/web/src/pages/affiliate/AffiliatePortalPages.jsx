import { Banknote, Link2, Percent, ShoppingCart, Users } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Card, CardBody, CardHeader, EmptyState } from '../../components/ui/index.js';
import { StudentAffiliatePage } from '../creator/AffiliatesPage.jsx';

export function AffiliateDashboardPage() {
  return <StudentAffiliatePage />;
}

export function AffiliateLinksPage() {
  return (
    <>
      <PageHeader
        title="Links & Coupons"
        description="Manage your referral tracking links and personalized coupon codes."
        breadcrumbs={[{ label: 'Affiliate', to: '/affiliate' }, { label: 'Links' }]}
      />
      <Card>
        <CardBody className="py-12">
          <EmptyState
            icon={Link2}
            title="Referral Links & Coupons"
            description="Your personal referral links and assigned coupon codes will appear here."
          />
        </CardBody>
      </Card>
    </>
  );
}

export function AffiliateConversionsPage() {
  return (
    <>
      <PageHeader
        title="Conversions"
        description="Real-time sales and enrollment conversions generated through your links."
        breadcrumbs={[{ label: 'Affiliate', to: '/affiliate' }, { label: 'Conversions' }]}
      />
      <Card>
        <CardBody className="py-12">
          <EmptyState
            icon={ShoppingCart}
            title="No conversions yet"
            description="Share your referral link on social media or your blog to start generating sales."
          />
        </CardBody>
      </Card>
    </>
  );
}

export function AffiliateCommissionsPage() {
  return (
    <>
      <PageHeader
        title="Commissions"
        description="Detailed commission earnings per conversion and holding status."
        breadcrumbs={[{ label: 'Affiliate', to: '/affiliate' }, { label: 'Commissions' }]}
      />
      <Card>
        <CardBody className="py-12">
          <EmptyState
            icon={Percent}
            title="Commission Ledger"
            description="All verified commissions and hold periods will be recorded here."
          />
        </CardBody>
      </Card>
    </>
  );
}

export function AffiliatePayoutsPage() {
  return (
    <>
      <PageHeader
        title="Payouts"
        description="Payout history and upcoming settlements to your bank or UPI account."
        breadcrumbs={[{ label: 'Affiliate', to: '/affiliate' }, { label: 'Payouts' }]}
      />
      <Card>
        <CardBody className="py-12">
          <EmptyState
            icon={Banknote}
            title="Payout Records"
            description="Approved payout disbursements and transaction references will be listed here."
          />
        </CardBody>
      </Card>
    </>
  );
}
