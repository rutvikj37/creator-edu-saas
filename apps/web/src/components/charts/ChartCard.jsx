import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from '../ui/index.js';

const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 };
const axis = { tickLine: false, axisLine: false, tick: { fill: 'var(--muted)', fontSize: 11 } };
export const SERIES_COLORS = ['var(--primary-600)', '#0d9488', '#d97706', '#db2777', '#7c3aed', '#0284c7'];

function shortDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function TrendChart({ title, description, data, loading, dataKey = 'count', height = 220 }) {
  const total = (data ?? []).reduce((s, d) => s + d[dataKey], 0);
  const gradientId = `g-${title.replace(/\W+/g, '-')}`;
  return (
    <Card>
      <CardHeader title={title} description={description} actions={!loading && <span className="text-lg font-semibold tabular-nums">{total}</span>} />
      <CardBody>
        {loading ? (
          <Skeleton style={{ height }} className="w-full" />
        ) : (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ left: -24, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary-500)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--primary-500)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28} {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={shortDate} />
                <Area type="monotone" dataKey={dataKey} name={title} stroke="var(--primary-600)" strokeWidth={2} fill={`url(#${gradientId})`} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function BreakdownChart({ title, description, data, loading, height = 220 }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>
        {loading ? (
          <Skeleton style={{ height }} className="w-full" />
        ) : !data?.length ? (
          <EmptyState title="No data yet" className="py-8" />
        ) : (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid stroke="var(--line)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...axis} />
                <YAxis type="category" dataKey="name" width={110} {...axis} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--surface-2)' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
