import { useRouteError } from 'react-router';
import { ErrorState } from '../components/ui/index.js';

/** Route-level error boundary: a crash in one page never blanks the whole app. */
export function RouteError() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <ErrorState title="This page failed to load" error={{ message: 'An unexpected error occurred. Reload the page to try again.' }} onRetry={() => window.location.reload()} />
    </div>
  );
}
