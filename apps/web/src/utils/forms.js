import { toast } from 'sonner';
import { toApiError } from '../services/api/client.js';

/**
 * Maps an API validation error onto react-hook-form fields so server-side validation
 * messages appear next to the right inputs; anything unmapped becomes a toast.
 * Returns true if at least one field error was applied.
 */
export function applyApiErrors(error, setError, knownFields = []) {
  const apiError = toApiError(error);
  let applied = false;
  for (const d of apiError.details ?? []) {
    if (!knownFields.length || knownFields.includes(d.field)) {
      setError(d.field, { type: 'server', message: d.message });
      applied = true;
    }
  }
  if (!applied) toast.error(apiError.message);
  return applied;
}
