import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, Eye, EyeOff, RotateCcw, Rocket, Trash2, X } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Alert } from '../../components/auth/Alert.jsx';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { RichTextEditor } from '../../components/forms/RichTextEditor.jsx';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, ErrorState, Input, Modal, Select, Skeleton, StatusBadge, Switch, Tabs, Textarea, toast } from '../../components/ui/index.js';
import { coursesApi } from '../../services/api/creator.js';
import { platformApi } from '../../services/api/platform.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate } from '../../utils/format.js';
import { CurriculumBuilder } from './CurriculumBuilder.jsx';
import { LessonEditor } from './LessonEditor.jsx';

function ListEditor({ label, values, onChange, placeholder }) {
  const [text, setText] = useState('');
  const add = () => { if (text.trim()) { onChange([...(values ?? []), text.trim()]); setText(''); } };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-fg-2">{label}</p>
      <ul className="space-y-1">
        {(values ?? []).map((v, i) => (
          <li key={`${v}-${i}`} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm">
            <span className="flex-1">{v}</span>
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((_, j) => j !== i))} className="text-muted hover:text-fg"><X className="size-3.5" /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input aria-label={`Add to ${label}`} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button variant="secondary" onClick={add} disabled={!text.trim()}>Add</Button>
      </div>
    </div>
  );
}

const pick = (c) => ({
  title: c.title, slug: c.slug, shortDescription: c.shortDescription ?? '', description: c.description ?? null, categorySlug: c.categorySlug ?? '', level: c.level, language: c.language,
  objectives: c.objectives ?? [], prerequisites: c.prerequisites ?? [], tags: c.tags ?? [], durationMinutes: c.durationMinutes ?? '',
  isFree: c.isFree, priceAmount: c.priceAmount ?? '', compareAtAmount: c.compareAtAmount ?? '', currency: c.currency,
  visibility: c.visibility, accessType: c.accessType, accessDays: c.accessDays ?? '', accessUntil: c.accessUntil ? c.accessUntil.slice(0, 10) : '',
  dripType: c.dripType, completionPercent: c.completionPercent, certificateEnabled: c.certificateEnabled, seoTitle: c.seoTitle ?? '', seoDescription: c.seoDescription ?? '',
});

export function CourseEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'details';
  const setTab = (t) => setParams({ tab: t }, { replace: true });
  const readOnly = !auth.can('courses.manage');

  const course = useQuery({ queryKey: ['course', id], queryFn: () => coursesApi.get(id) });
  const curriculum = useQuery({ queryKey: ['course', id, 'curriculum'], queryFn: () => coursesApi.curriculum(id) });
  const categories = useQuery({ queryKey: ['categories'], queryFn: platformApi.categories, staleTime: 5 * 60_000 });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [thumb, setThumb] = useState(null);
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Readiness must reflect the latest saved state every time the dialog opens.
  const check = useQuery({ queryKey: ['course', id, 'check'], queryFn: () => coursesApi.publishCheck(id), enabled: publishOpen, staleTime: 0, gcTime: 0 });

  useEffect(() => {
    if (course.data) {
      setForm(pick(course.data));
      setThumb(course.data.thumbnailFileId ? { id: course.data.thumbnailFileId, url: course.data.thumbnailUrl } : null);
      setBanner(course.data.bannerFileId ? { id: course.data.bannerFileId, url: course.data.bannerUrl } : null);
    }
  }, [course.data]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['course', id] }); qc.invalidateQueries({ queryKey: ['courses'] }); };
  const save = useMutation({
    mutationFn: () => {
      const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
      return coursesApi.update(id, {
        ...form,
        categorySlug: form.categorySlug || null,
        durationMinutes: n(form.durationMinutes),
        priceAmount: form.isFree ? null : n(form.priceAmount),
        compareAtAmount: form.isFree ? null : n(form.compareAtAmount),
        accessDays: form.accessType === 'FIXED_DAYS' ? n(form.accessDays) : null,
        accessUntil: form.accessType === 'FIXED_DATE' && form.accessUntil ? new Date(`${form.accessUntil}T23:59:59Z`).toISOString() : null,
        seoTitle: form.seoTitle || null,
        seoDescription: form.seoDescription || null,
        thumbnailFileId: thumb?.id ?? null,
        bannerFileId: banner?.id ?? null,
      });
    },
    onSuccess: (data) => { setErrors({}); qc.setQueryData(['course', id], data); qc.invalidateQueries({ queryKey: ['courses'] }); toast.success('Course saved'); },
    onError: (e) => { setErrors(Object.fromEntries((e.details ?? []).map((d) => [d.field, d.message]))); toast.error(e.details?.length ? 'Please fix the highlighted fields' : e.message); },
  });
  const useAction = (fn, msg, after) => useMutation({ mutationFn: fn, onSuccess: (d) => { toast.success(msg); refresh(); after?.(d); }, onError: (e) => toast.error(e.message) });
  const publish = useAction(() => coursesApi.publish(id, scheduleAt ? { publishAt: new Date(scheduleAt).toISOString() } : {}), scheduleAt ? 'Publishing scheduled' : 'Course published', () => setPublishOpen(false));
  const unpublish = useAction(() => coursesApi.unpublish(id), 'Course unpublished');
  const archive = useAction(() => coursesApi.archive(id), 'Course archived');
  const restore = useAction(() => coursesApi.restore(id), 'Course restored');
  const duplicate = useAction(() => coursesApi.duplicate(id), 'Copy created', (c) => navigate(`/creator/courses/${c.id}`));
  const remove = useAction(() => coursesApi.remove(id), 'Course deleted', () => navigate('/creator/courses'));

  if (course.isError) return <Card><ErrorState error={course.error} onRetry={() => course.refetch()} /></Card>;
  if (course.isLoading || !form) return <Skeleton className="h-96" />;
  const c = course.data;
  const set = (k) => (e) => setForm({ ...form, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  const isLive = c.status === 'PUBLISHED' || c.status === 'SCHEDULED';

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{c.title} <StatusBadge status={c.status} /></span>}
        description={c.status === 'SCHEDULED' ? `Publishes ${formatDate(c.publishAt, { withTime: true })}` : c.publishedAt ? `Published ${formatDate(c.publishedAt)}` : 'Not published yet'}
        breadcrumbs={[{ label: 'Courses', to: '/creator/courses' }, { label: c.title }]}
        actions={!readOnly && (
          <>
            {['details', 'pricing', 'seo'].includes(tab) && <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>}
            {c.status === 'ARCHIVED' ? <Button variant="secondary" leftIcon={RotateCcw} loading={restore.isPending} onClick={() => restore.mutate()}>Restore</Button> : isLive ? (
              <Button variant="secondary" leftIcon={EyeOff} loading={unpublish.isPending} onClick={() => unpublish.mutate()}>Unpublish</Button>
            ) : <Button leftIcon={Rocket} onClick={() => { setScheduleAt(''); setPublishOpen(true); }}>Publish</Button>}
            <Button variant="ghost" size="icon" aria-label="Duplicate course" title="Duplicate" loading={duplicate.isPending} onClick={() => duplicate.mutate()}><Copy className="size-4" /></Button>
            {c.status !== 'ARCHIVED' && !isLive && <Button variant="ghost" size="icon" aria-label="Archive course" title="Archive" onClick={() => archive.mutate()}><Archive className="size-4" /></Button>}
            {!isLive && <Button variant="ghost" size="icon" aria-label="Delete course" title="Delete" onClick={() => setDeleteOpen(true)}><Trash2 className="size-4" /></Button>}
          </>
        )}
      />
      <Tabs className="mb-6" value={tab} onChange={setTab} tabs={[{ value: 'details', label: 'Details' }, { value: 'curriculum', label: 'Curriculum' }, { value: 'pricing', label: 'Pricing & access' }, { value: 'seo', label: 'SEO' }]} />

      {tab === 'details' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card><CardBody className="grid gap-4">
              <Input label="Title" value={form.title} onChange={set('title')} error={errors.title} />
              <Input label="URL slug" value={form.slug} onChange={set('slug')} error={errors.slug} hint="Used in the course address on your academy site." />
              <Textarea label="Short description" rows={2} value={form.shortDescription} onChange={set('shortDescription')} error={errors.shortDescription} hint={`${form.shortDescription.length}/500`} />
              <RichTextEditor label="Full description" value={form.description} onChange={set('description')} error={errors.description} />
            </CardBody></Card>
            <Card><CardBody className="grid gap-6 sm:grid-cols-2">
              <ListEditor label="What students will learn" values={form.objectives} onChange={set('objectives')} placeholder="e.g. Design a mobile app screen" />
              <ListEditor label="Prerequisites" values={form.prerequisites} onChange={set('prerequisites')} placeholder="e.g. Basic computer skills" />
            </CardBody></Card>
          </div>
          <div className="space-y-6">
            <Card><CardHeader title="Media" /><CardBody className="space-y-5">
              <FileUpload purpose="COURSE_THUMBNAIL" accept="image/png,image/jpeg,image/webp" label="Thumbnail (16:9)" hint="PNG/JPG/WebP, max 5 MB" value={thumb} onUploaded={(f) => setThumb({ id: f.id, url: f.url })} onClear={() => setThumb(null)} />
              <FileUpload purpose="COURSE_BANNER" accept="image/png,image/jpeg,image/webp" label="Banner" hint="Max 10 MB" value={banner} onUploaded={(f) => setBanner({ id: f.id, url: f.url })} onClear={() => setBanner(null)} />
              <p className="text-xs text-muted">Click “Save changes” to apply new images.</p>
            </CardBody></Card>
            <Card><CardHeader title="Organisation" /><CardBody className="space-y-4">
              <Select label="Category" placeholder="None" value={form.categorySlug} onChange={set('categorySlug')} options={(categories.data ?? []).map((x) => ({ value: x.slug, label: x.name }))} error={errors.categorySlug} />
              <Select label="Level" value={form.level} onChange={set('level')} options={[{ value: 'ALL_LEVELS', label: 'All levels' }, { value: 'BEGINNER', label: 'Beginner' }, { value: 'INTERMEDIATE', label: 'Intermediate' }, { value: 'ADVANCED', label: 'Advanced' }]} />
              <Select label="Language" value={form.language} onChange={set('language')} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }, { value: 'gu', label: 'ગુજરાતી' }]} />
              <Input label="Total duration (minutes)" type="number" min={0} value={form.durationMinutes} onChange={set('durationMinutes')} />
              <Select label="Visibility" value={form.visibility} onChange={set('visibility')} options={[{ value: 'PUBLIC', label: 'Public — listed on your site' }, { value: 'UNLISTED', label: 'Unlisted — direct link only' }, { value: 'PRIVATE', label: 'Private — enrolled students only' }]} />
              <div><p className="text-sm font-medium text-fg-2">Instructors</p><div className="mt-2 flex flex-wrap gap-1">{c.instructors.map((i) => <Badge key={i.id}>{i.fullName}{i.isPrimary ? ' (primary)' : ''}</Badge>)}</div></div>
            </CardBody></Card>
          </div>
        </div>
      )}

      {tab === 'curriculum' && (
        curriculum.isLoading ? <Skeleton className="h-64" /> : curriculum.isError ? <Card><ErrorState error={curriculum.error} onRetry={() => curriculum.refetch()} /></Card> : (
          <div className="max-w-3xl">
            <CurriculumBuilder courseId={id} sections={curriculum.data} readOnly={readOnly} onChange={(d) => qc.setQueryData(['course', id, 'curriculum'], d)} onEditLesson={setEditing} />
          </div>
        )
      )}

      {tab === 'pricing' && (
        <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
          <Card><CardHeader title="Price" /><CardBody className="space-y-4">
            <Switch label="Free course" checked={form.isFree} onChange={set('isFree')} />
            {!form.isFree && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Input label="Price" type="number" min={0} step="0.01" value={form.priceAmount} onChange={set('priceAmount')} error={errors.priceAmount} />
                <Input label="Original price" type="number" min={0} step="0.01" value={form.compareAtAmount} onChange={set('compareAtAmount')} error={errors.compareAtAmount} hint="Shown struck through" />
                <Select label="Currency" value={form.currency} onChange={set('currency')} options={['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'].map((x) => ({ value: x, label: x }))} />
              </div>
            )}
            <p className="text-xs text-muted">Checkout and payments are enabled with the commerce module.</p>
          </CardBody></Card>
          <Card><CardHeader title="Access" /><CardBody className="space-y-4">
            <Select label="Access duration" value={form.accessType} onChange={set('accessType')} options={[{ value: 'LIFETIME', label: 'Lifetime' }, { value: 'FIXED_DAYS', label: 'Number of days after enrolment' }, { value: 'FIXED_DATE', label: 'Until a fixed date' }]} />
            {form.accessType === 'FIXED_DAYS' && <Input label="Days of access" type="number" min={1} value={form.accessDays} onChange={set('accessDays')} error={errors.accessDays} />}
            {form.accessType === 'FIXED_DATE' && <Input label="Access ends on" type="date" value={form.accessUntil} onChange={set('accessUntil')} error={errors.accessUntil} />}
            <Select label="Drip content" value={form.dripType} onChange={set('dripType')} options={[{ value: 'NONE', label: 'All content available immediately' }, { value: 'DAYS_AFTER_ENROLL', label: 'Unlock sections days after enrolment' }, { value: 'DATE', label: 'Unlock sections on dates' }]} />
            <Input label="Completion threshold (%)" type="number" min={1} max={100} value={form.completionPercent} onChange={set('completionPercent')} hint="Share of required lessons to complete the course" />
            <Checkbox label="Issue a certificate on completion" checked={form.certificateEnabled} onChange={set('certificateEnabled')} />
          </CardBody></Card>
        </div>
      )}

      {tab === 'seo' && (
        <Card className="max-w-3xl"><CardBody className="space-y-4">
          <Input label="SEO title" value={form.seoTitle} onChange={set('seoTitle')} hint={`${form.seoTitle.length}/70 · defaults to the course title`} error={errors.seoTitle} />
          <Textarea label="Meta description" rows={3} value={form.seoDescription} onChange={set('seoDescription')} hint={`${form.seoDescription.length}/170`} error={errors.seoDescription} />
          <div className="rounded-lg border border-line p-4">
            <p className="text-xs text-muted">Search preview</p>
            <p className="mt-1 truncate text-base text-[#1a0dab]">{form.seoTitle || form.title}</p>
            <p className="line-clamp-2 text-sm text-fg-2">{form.seoDescription || form.shortDescription || 'Add a description to improve search results.'}</p>
          </div>
        </CardBody></Card>
      )}

      <LessonEditor courseId={id} lesson={editing} readOnly={readOnly} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['course', id, 'curriculum'] }); }} />

      <Modal open={publishOpen} onClose={() => setPublishOpen(false)} title="Publish course" size="lg"
        footer={<><Button variant="secondary" onClick={() => setPublishOpen(false)}>Cancel</Button><Button leftIcon={Eye} disabled={!check.data?.ready} loading={publish.isPending} onClick={() => publish.mutate()}>{scheduleAt ? 'Schedule' : 'Publish now'}</Button></>}>
        {check.isLoading ? <Skeleton className="h-24" /> : check.data?.ready ? (
          <div className="space-y-4">
            <Alert tone="success" title="Ready to publish">All checks passed.</Alert>
            <Input label="Schedule for later (optional)" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          </div>
        ) : (
          <Alert tone="error" title="Fix these before publishing">
            <ul className="mt-1 list-disc space-y-1 pl-4">{(check.data?.problems ?? []).map((p) => <li key={p.field + p.message}>{p.message}</li>)}</ul>
          </Alert>
        )}
      </Modal>
      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={`Delete “${c.title}”?`} description="The course and its curriculum will be removed." confirmLabel="Delete course" loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}
