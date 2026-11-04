import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { academyApi } from '../../services/api/auth.js';
import { ErrorState, Skeleton } from '../../components/ui/index.js';
import { useAuth } from '../../context/AuthContext.jsx';

/** Academy home on its own host. The full page-builder website replaces this in Phase 8. */
export function AcademyLandingPage() {
  const auth = useAuth();
  const site = useQuery({ queryKey: ['brand', 'academy'], queryFn: academyApi.site, staleTime: 5 * 60_000, retry: false });
  if (site.isError) {
    return <div className="grid min-h-dvh place-items-center"><ErrorState title="Academy not found" error={{ message: 'There is no academy at this address.' }} /></div>;
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
        {site.isLoading ? <Skeleton className="h-6 w-40" /> : <span className="font-semibold">{site.data.name}</span>}
        <nav className="flex gap-2">
          {auth.status === 'authenticated' ? (
            <Link to="/learn" className="inline-flex h-9 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-on-primary">My learning</Link>
          ) : (
            <>
              <Link to="/login" className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-fg-2 hover:bg-surface-2">Sign in</Link>
              {site.data?.acceptingRegistrations && <Link to="/register" className="inline-flex h-9 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-on-primary">Join</Link>}
            </>
          )}
        </nav>
      </header>
      <main className="mx-auto grid w-full max-w-6xl flex-1 place-items-center px-4 text-center">
        <div>
          {site.isLoading ? <Skeleton className="mx-auto h-10 w-72" /> : <h1 className="text-4xl font-semibold tracking-tight">{site.data.name}</h1>}
          {site.data && !site.data.isLive && <p className="mt-3 text-muted">This academy is getting ready to launch.</p>}
        </div>
      </main>
    </div>
  );
}
