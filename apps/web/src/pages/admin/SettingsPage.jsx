import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button, Card, CardBody, ErrorState, Input, Skeleton, Switch, Tabs, toast } from '../../components/ui/index.js';
import { platformApi } from '../../services/api/platform.js';

const GROUP_LABELS = { branding: 'Branding', general: 'General', registration: 'Registration', email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', payments: 'Payments', tax: 'Tax', legal: 'Legal', video: 'Video costs', backups: 'Backups', system: 'System' };

export function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'settings'], queryFn: platformApi.settings });
  const [group, setGroup] = useState('branding');
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(q.data.flatMap((g) => g.items.map((i) => [i.key, i.value]))));
  }, [q.data]);

  const save = useMutation({
    mutationFn: (items) => platformApi.updateSettings(items),
    onSuccess: (data) => { setErrors({}); toast.success('Settings saved'); qc.setQueryData(['platform', 'settings'], data); qc.invalidateQueries({ queryKey: ['system', 'info'] }); },
    onError: (e) => { setErrors(Object.fromEntries((e.details ?? []).map((d) => [d.field, d.message]))); toast.error(e.message); },
  });

  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const current = q.data?.find((g) => g.group === group);

  const onSave = () => {
    const items = current.items
      .filter((i) => !i.secret || draft[i.key] !== '••••••••')
      .map((i) => {
        const original = i.value;
        let value = draft[i.key];
        if (typeof original === 'number' || i.key === 'tax.defaultGstRate') value = value === '' || value === null ? 0 : Number(value);
        if (value === null || value === undefined) value = typeof original === 'boolean' ? false : '';
        return { key: i.key, value };
      });
    save.mutate(items);
  };

  return (
    <>
      <PageHeader title="Platform settings" description="Branding, defaults and policies for the whole platform." breadcrumbs={[{ label: 'System' }, { label: 'Settings' }]} />
      {q.isLoading ? <Skeleton className="h-80" /> : (
        <>
          <Tabs className="mb-6" value={group} onChange={setGroup} tabs={q.data.map((g) => ({ value: g.group, label: GROUP_LABELS[g.group] ?? g.group }))} />
          <Card>
            <CardBody className="grid max-w-2xl gap-5">
              {current.items.map((i) => {
                const v = draft[i.key];
                const isBool = typeof i.value === 'boolean' || /Mode|Enabled|require/i.test(i.key);
                return isBool ? (
                  <div key={i.key}>
                    <Switch label={i.label} checked={Boolean(v)} onChange={(val) => setDraft((d) => ({ ...d, [i.key]: val }))} />
                    {errors[i.key] && <p className="mt-1 text-xs text-red-600">{errors[i.key]}</p>}
                  </div>
                ) : (
                  <Input key={i.key} label={i.label} type={i.key === 'tax.defaultGstRate' ? 'number' : i.secret ? 'password' : 'text'} value={v ?? ''} error={errors[i.key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [i.key]: e.target.value }))} hint={i.updatedAt ? `Last updated ${new Date(i.updatedAt).toLocaleString()}` : undefined} />
                );
              })}
              <div><Button loading={save.isPending} onClick={onSave}>Save {GROUP_LABELS[group]?.toLowerCase()} settings</Button></div>
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}
