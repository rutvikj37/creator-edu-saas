import { BookOpen } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { EmailVerificationBanner } from '../../components/account/EmailVerificationBanner.jsx';
import { Card, EmptyState } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';

/** Student home. Enrolled courses are listed here once the LMS ships (Phase 5). */
export function StudentHomePage() {
  const auth = useAuth();
  return (
    <>
      <PageHeader title={`Hi, ${auth.user?.fullName?.split(' ')[0] ?? 'there'}`} description="Pick up where you left off." breadcrumbs={[{ label: 'Home' }]} />
      <EmailVerificationBanner />
      <Card>
        <EmptyState icon={BookOpen} title="No courses yet" description="Courses you enrol in will appear here." />
      </Card>
    </>
  );
}
