/** Read-only JSON viewer for audit snapshots. React escapes the text, so it is XSS-safe. */
export function JsonView({ value }) {
  if (value === null || value === undefined) return <p className="text-sm text-muted">—</p>;
  return <pre className="max-h-72 overflow-auto rounded-md bg-surface-2 p-3 text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
}
