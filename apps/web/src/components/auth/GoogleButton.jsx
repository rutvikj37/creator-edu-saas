import { useQuery } from '@tanstack/react-query';
import { authApi } from '../../services/api/auth.js';

/** Shown only when Google sign-in is configured on the server. */
export function GoogleButton() {
  const providers = useQuery({ queryKey: ['auth', 'providers'], queryFn: authApi.providers, staleTime: 5 * 60_000 });
  if (!providers.data?.google) return null;
  return (
    <>
      <a
        href="/api/v1/auth/google/start"
        className="flex h-10 w-full items-center justify-center gap-2.5 rounded-md border border-line bg-surface text-sm font-medium shadow-xs hover:bg-surface-2"
      >
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.3 6.6 2.3 12s4.3 9.8 9.7 9.8c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
        </svg>
        Continue with Google
      </a>
      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}
