import { Link, useLocation } from 'react-router';
import { LayoutTemplate } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Card, EmptyState } from '../../components/ui/index.js';

export const PREVIEW_PANELS = [
  { key: 'super-admin', label: 'Super Admin' },
  { key: 'finance', label: 'Finance Admin' },
  { key: 'support', label: 'Support Admin' },
  { key: 'creator', label: 'Creator' },
  { key: 'student', label: 'Student' },
  { key: 'affiliate', label: 'Affiliate' },
];

/** Shows a panel's real navigation shell so the information architecture can be reviewed. */
export function LayoutPreviewPage() {
  const panel = useLocation().pathname.split('/')[2];
  const current = PREVIEW_PANELS.find((p) => p.key === panel);
  return (
    <>
      <PageHeader title={`${current?.label ?? 'Panel'} layout`} description="Navigation preview. Greyed items show the phase in which they are delivered."
        breadcrumbs={[{ label: 'Layout previews' }, { label: current?.label ?? panel }]} />
      <div className="mb-6 flex flex-wrap gap-2">
        {PREVIEW_PANELS.map((p) => (
          <Link key={p.key} to={`/preview/${p.key}`}
            className={`rounded-full border px-3 py-1 text-sm ${p.key === panel ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-line text-fg-2 hover:bg-surface-2'}`}>
            {p.label}
          </Link>
        ))}
      </div>
      <Card>
        <EmptyState icon={LayoutTemplate} title="Pages arrive with their phase"
          description="This shell — sidebar, search (⌘K), notifications, theme and language switches — is shared by all panels. Screens are added phase by phase." />
      </Card>
    </>
  );
}
