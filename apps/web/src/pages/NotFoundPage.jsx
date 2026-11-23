import { Link, useLocation } from 'react-router';
import { Compass, ExternalLink, Globe } from 'lucide-react';
import { Button, Card, EmptyState } from '../components/ui/index.js';
import { getSurface } from '../utils/host.js';

const ACADEMY_PREFIXES = ['/learn', '/courses', '/checkout', '/cart', '/bundles', '/products', '/memberships', '/webinars', '/live'];

export function NotFoundPage() {
  const location = useLocation();
  const isPlatformHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname.toLowerCase());
  const isAcademyRoute = ACADEMY_PREFIXES.some((p) => location.pathname.startsWith(p));
  const currentSurface = getSurface();

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="max-w-md space-y-4 text-center">
        <EmptyState
          icon={Compass}
          title="Page not found"
          description="The page you're looking for doesn't exist or has moved."
          action={
            <Link to="/" className="inline-flex h-9 items-center rounded-md bg-primary-600 px-4 text-sm font-medium text-on-primary hover:bg-primary-700">
              Go home
            </Link>
          }
        />

        {isPlatformHost && currentSurface === 'platform' && isAcademyRoute && (
          <Card className="mt-4 p-4 text-left border-primary-200 bg-primary-50/50 dark:border-primary-900 dark:bg-primary-950/30">
            <div className="flex items-start gap-3">
              <Globe className="mt-0.5 size-5 shrink-0 text-primary-600 dark:text-primary-400" />
              <div className="space-y-2">
                <p className="text-sm font-semibold text-fg">Looking for Academy / Student pages?</p>
                <p className="text-xs text-muted">
                  You are currently on the Platform admin host (<code className="font-mono text-xs">localhost</code>). In local dev, academy and student courses live on academy subdomains.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <a
                    href={`http://techx-solutions.lvh.me:${window.location.port || '5173'}${location.pathname}${location.search}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
                  >
                    Open in techx-solutions.lvh.me <ExternalLink className="size-3" />
                  </a>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                      const url = new URL(window.location.href);
                      url.searchParams.set('surface', 'academy');
                      window.location.href = url.toString();
                    }}
                  >
                    Force academy view (?surface=academy)
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
