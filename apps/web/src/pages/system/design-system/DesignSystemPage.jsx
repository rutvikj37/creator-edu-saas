import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BookOpen, IndianRupee, Plus, Trash2, Users } from 'lucide-react';
import { PageHeader } from '../../../components/layout/PageHeader.jsx';
import {
  Avatar, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, Drawer, EmptyState, Modal, Skeleton,
  StatCard, StatusBadge, Switch, Tabs, toast,
} from '../../../components/ui/index.js';
import { formatMoney } from '../../../utils/format.js';
import { FormShowcase } from './FormShowcase.jsx';

// Component gallery only — sample values below illustrate components and are never shown on product dashboards.
const SAMPLE_ROWS = Array.from({ length: 23 }, (_, i) => ({
  id: `row-${i + 1}`,
  name: ['Aarav Shah', 'Diya Patel', 'Kabir Rao', 'Meera Iyer', 'Rohan Das'][i % 5],
  course: ['React Mastery', 'UPSC Foundation', 'Watercolour Basics'][i % 3],
  status: ['ACTIVE', 'PENDING', 'SUSPENDED'][i % 3],
  amount: 499 + i * 150,
}));
const SAMPLE_SERIES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((m, i) => ({ month: m, value: [12, 18, 15, 24, 29, 35][i] }));

function Section({ title, description, children }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function TableShowcase() {
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const sorted = useMemo(() => {
    if (!sort) return SAMPLE_ROWS;
    const desc = sort.startsWith('-');
    const key = desc ? sort.slice(1) : sort;
    return [...SAMPLE_ROWS].sort((a, b) => (a[key] > b[key] ? 1 : -1) * (desc ? -1 : 1));
  }, [sort]);
  return (
    <DataTable
      columns={[
        { key: 'name', header: 'Student', sortable: true, cell: (r) => <span className="flex items-center gap-2"><Avatar name={r.name} size="sm" />{r.name}</span> },
        { key: 'course', header: 'Course' },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        { key: 'amount', header: 'Amount', sortable: true, align: 'right', cell: (r) => formatMoney(r.amount, 'INR') },
      ]}
      rows={sorted.slice((page - 1) * pageSize, page * pageSize)}
      sort={sort}
      onSortChange={setSort}
      meta={{ page, pageSize, total: SAMPLE_ROWS.length }}
      onPageChange={setPage}
    />
  );
}

export function DesignSystemPage() {
  const [tab, setTab] = useState('buttons');
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [on, setOn] = useState(true);

  return (
    <>
      <PageHeader
        title="Design system"
        description="Shared building blocks used by every panel. Values on this page are illustrative samples."
        breadcrumbs={[{ label: 'System' }, { label: 'Design system' }]}
      />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Revenue" value={formatMoney(125400, 'INR')} delta={0.124} hint="vs last month" icon={IndianRupee} />
          <StatCard label="Students" value="1,284" delta={-0.032} hint="vs last month" icon={Users} />
          <StatCard label="Courses" value="18" hint="6 drafts" icon={BookOpen} />
          <StatCard label="Loading state" loading icon={BookOpen} />
        </div>

        <Section title="Controls">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'buttons', label: 'Buttons' },
              { value: 'badges', label: 'Badges', count: 8 },
              { value: 'overlays', label: 'Overlays' },
            ]}
          />
          <div className="pt-5">
            {tab === 'buttons' && (
              <div className="flex flex-wrap items-center gap-3">
                <Button leftIcon={Plus}>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger" leftIcon={Trash2}>Danger</Button>
                <Button loading>Saving</Button>
                <Button size="sm">Small</Button>
                <Button size="lg">Large</Button>
                <Switch checked={on} onChange={setOn} label="Notifications" />
              </div>
            )}
            {tab === 'badges' && (
              <div className="flex flex-wrap gap-2">
                {['neutral', 'primary', 'success', 'warning', 'danger', 'info'].map((t) => <Badge key={t} tone={t}>{t}</Badge>)}
                <StatusBadge status="PUBLISHED" />
                <StatusBadge status="PAYMENT_INITIATED" />
              </div>
            )}
            {tab === 'overlays' && (
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => setModal(true)}>Open modal</Button>
                <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
                <Button variant="danger" onClick={() => setConfirm(true)}>Delete…</Button>
                <Button variant="secondary" onClick={() => toast.success('Saved', { description: 'Your changes were saved.' })}>Toast</Button>
              </div>
            )}
          </div>
        </Section>

        <Section title="Form pattern" description="zod schema + react-hook-form, inline errors, accessible labels.">
          <FormShowcase />
        </Section>

        <Card>
          <CardHeader title="Data table" description="Sortable, paginated, collapses to cards on mobile." />
          <TableShowcase />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Chart" description="Recharts with theme tokens.">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={SAMPLE_SERIES} margin={{ left: -20, right: 8 }}>
                  <defs>
                    <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary-500)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--primary-500)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }} />
                  <Area type="monotone" dataKey="value" stroke="var(--primary-600)" strokeWidth={2} fill="url(#fill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Section>
          <Section title="Empty & loading states">
            <EmptyState title="No courses yet" description="Create your first course to start selling." action={<Button leftIcon={Plus} size="sm">Create course</Button>} className="py-6" />
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </Section>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Modal title" description="Native dialog with focus trap."
        footer={<><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button onClick={() => setModal(false)}>Done</Button></>}>
        <p className="text-sm text-fg-2">Press Escape or click outside to close.</p>
      </Modal>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Details">
        <p className="text-sm text-fg-2">Drawers hold detail views and secondary forms.</p>
      </Drawer>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Delete academy?" confirmText="delete"
        description="This permanently removes the academy after the retention period." confirmLabel="Delete"
        onConfirm={() => { setConfirm(false); toast.success('Confirmed'); }} />
    </>
  );
}
