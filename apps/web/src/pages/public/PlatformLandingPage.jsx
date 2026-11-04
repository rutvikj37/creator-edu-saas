import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, CreditCard, Globe, Radio, ShieldCheck, Users } from 'lucide-react';
import { systemApi } from '../../services/api/system.js';
import { Card } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { landingPath } from '../../routes/guards.jsx';

const FEATURES = [
  { icon: BookOpen, title: 'Courses & cohorts', text: 'Build structured courses with video, quizzes and certificates.' },
  { icon: Radio, title: 'Live classes', text: 'Teach live with attendance, chat and recordings.' },
  { icon: CreditCard, title: 'Payments', text: 'Sell with UPI, cards and international payments.' },
  { icon: Globe, title: 'Your brand', text: 'Your own website and domain, your colours.' },
  { icon: Users, title: 'Growth tools', text: 'Coupons, affiliates, email and WhatsApp campaigns.' },
  { icon: ShieldCheck, title: 'Secure by default', text: 'Protected content, two-factor sign-in and audit trails.' },
];

/** Platform marketing entry (www / app host). */
export function PlatformLandingPage() {
  const auth = useAuth();
  const info = useQuery({ queryKey: ['system', 'info'], queryFn: systemApi.info, staleTime: 5 * 60_000 });
  const name = info.data?.name ?? '';
  const signedIn = auth.status === 'authenticated';
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <span className="flex items-center gap-2.5 font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary-600 text-xs font-bold text-on-primary">{name.slice(0, 2).toUpperCase()}</span>
          {name}
        </span>
        <nav className="flex items-center gap-2">
          {signedIn ? (
            <Link to={landingPath(auth.me, auth.surface)} className="inline-flex h-9 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-on-primary hover:bg-primary-700">Go to dashboard</Link>
          ) : (
            <>
              <Link to="/login" className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-fg-2 hover:bg-surface-2">Sign in</Link>
              <Link to="/signup" className="inline-flex h-9 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-on-primary hover:bg-primary-700">Start free</Link>
            </>
          )}
        </nav>
      </header>
      <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 text-center sm:pt-24">
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Launch your online academy</h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted sm:text-lg">{info.data?.branding?.tagline ?? 'Create courses, teach live and get paid — all under your own brand.'}</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/signup" className="inline-flex h-11 items-center gap-2 rounded-md bg-primary-600 px-5 text-base font-medium text-on-primary hover:bg-primary-700">Create your academy <ArrowRight className="size-4" /></Link>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title} className="p-6">
            <f.icon className="size-5 text-primary-600" aria-hidden />
            <p className="mt-3 font-semibold">{f.title}</p>
            <p className="mt-1 text-sm text-muted">{f.text}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
