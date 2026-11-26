import { Navigate } from 'react-router';
import { StudentAffiliatePage } from '../creator/AffiliatesPage.jsx';

/** Dedicated /affiliate/* portal was never shipped — real affiliate UX lives at /learn/affiliate. */
export function AffiliateDashboardPage() {
  return <StudentAffiliatePage />;
}

export function AffiliateLinksPage() {
  return <Navigate to="/learn/affiliate" replace />;
}

export function AffiliateConversionsPage() {
  return <Navigate to="/learn/affiliate" replace />;
}

export function AffiliateCommissionsPage() {
  return <Navigate to="/learn/affiliate" replace />;
}

export function AffiliatePayoutsPage() {
  return <Navigate to="/learn/affiliate" replace />;
}
