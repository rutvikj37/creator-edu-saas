import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui/index.js';

export function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center">
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
    </div>
  );
}
