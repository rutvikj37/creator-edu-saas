import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, GraduationCap, UserPlus } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { SearchInput } from '../../components/common/SearchInput.jsx';
import { FilterChip } from '../../components/common/FilterChip.jsx';
import { presetRange } from '../../components/common/DateRangeFilter.jsx';
import { Avatar, Badge, Button, Card, Checkbox, DataTable, Drawer, EmptyState, Field, Input, Modal, Skeleton, StatusBadge, toast } from '../../components/ui/index.js';
import { creatorLearnApi } from '../../services/api/learn.js';
import { coursesApi } from '../../services/api/creator.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate } from '../../utils/format.js';
import { saveBlob } from '../../utils/download.js';
import { STUDENT_CSV_TEMPLATE, csvToStudents, parseCsv } from '../../utils/csv.js';
import { PhoneInput } from '../../components/forms/PhoneInput.jsx';
import { DIAL_CODES, joinPhone } from '../../utils/dialCodes.js';

const MAX_IMPORT = 1000;
const JOINED = [{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' }, { value: 'month', label: 'This month' }, { value: 'lastMonth', label: 'Last month' }];
const ACTIVE = [{ value: '7d', label: 'In the last 7 days' }, { value: '30d', label: 'In the last 30 days' }, { value: '90d', label: 'In the last 90 days' }, { value: 'never', label: 'Never signed in' }];

/** URL filter state → API query for the learner list. */
export function studentQuery(params) {
  const joined = params.joined ? presetRange(params.joined) : null;
  return {
    q: params.q, page: params.page, pageSize: params.pageSize, courseId: params.courseId,
    ...(joined ? { joinedFrom: joined.from, joinedTo: joined.to } : {}),
    ...(params.active === 'never' ? { neverSignedIn: 'true' } : params.active ? { activeFrom: presetRange(params.active).from } : {}),
  };
}

/** Date on the first line, time underneath — easier to scan down a column. */
function TwoLineDate({ value }) {
  if (!value) return <span className="text-muted">Never</span>;
  const d = new Date(value);
  return <div className="leading-tight"><p className="text-fg-2">{formatDate(value)}</p><p className="text-xs text-muted">{d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p></div>;
}

/** Optional course selection shared by "Add student" and "Import". */
function CoursePicker({ value, onChange }) {
  const q = useQuery({ queryKey: ['creator', 'courses', 'picker'], queryFn: () => coursesApi.list({ pageSize: 100, sort: 'title' }) });
  const courses = q.data?.items ?? [];
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <Field label="Enrol in courses" hint="Optional. Students get access right away.">
      {() => (
        <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border border-line p-3">
          {q.isLoading ? <Skeleton className="h-6" /> : courses.length === 0 ? <p className="text-sm text-muted">No courses yet.</p> : courses.map((c) => (
            <Checkbox key={c.id} label={c.title} description={c.status === 'PUBLISHED' ? undefined : c.status.toLowerCase()} checked={value.includes(c.id)} onChange={() => toggle(c.id)} />
          ))}
        </div>
      )}
    </Field>
  );
}

const blank = { fullName: '', email: '', phone: '', country: 'IN' };

function AddStudentModal({ open, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(blank);
  const [courseIds, setCourseIds] = useState([]);
  const [sendInvite, setSendInvite] = useState(true);
  const [errors, setErrors] = useState({});
  const close = () => { setForm(blank); setCourseIds([]); setSendInvite(true); setErrors({}); onClose(); };
  const save = useMutation({
    mutationFn: () => creatorLearnApi.addStudent({ fullName: form.fullName, email: form.email, phone: joinPhone(DIAL_CODES.find((d) => d.iso === form.country)?.code ?? '91', form.phone) || undefined, courseIds, sendInvite }),
    onSuccess: (r) => {
      toast.success(r.invited ? 'Student added and invitation sent' : 'Student added');
      qc.invalidateQueries({ queryKey: ['creator', 'students'] });
      close();
    },
    onError: (e) => {
      const byField = Object.fromEntries((e.details ?? []).map((d) => [d.field, d.message]));
      setErrors(Object.keys(byField).length ? byField : { form: e.message });
    },
  });
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined, form: undefined })); };
  return (
    <Modal open={open} onClose={close} title="Add student" description="Enter the student’s details to create their account manually."
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button disabled={!form.fullName.trim() || !form.email.trim()} loading={save.isPending} onClick={() => save.mutate()}>Add student</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Input label="Full name" required value={form.fullName} onChange={set('fullName')} error={errors.fullName} autoFocus maxLength={120} />
        <Input label="Email" type="email" required value={form.email} onChange={set('email')} error={errors.email} maxLength={191} />
        <PhoneInput label="Mobile" country={form.country} onCountryChange={(c) => setForm((f) => ({ ...f, country: c }))} number={form.phone}
          onNumberChange={(v) => { setForm((f) => ({ ...f, phone: v })); setErrors((x) => ({ ...x, phone: undefined, form: undefined })); }} error={errors.phone} hint="Optional" />
        <CoursePicker value={courseIds} onChange={setCourseIds} />
        <Checkbox label="Email a set-password link" description="The link is valid for 7 days." checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
        {errors.form && <p role="alert" className="text-sm text-red-600">{errors.form}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function ImportStudentsModal({ open, onClose }) {
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null); // { name, rows }
  const [parseError, setParseError] = useState(null);
  const [courseIds, setCourseIds] = useState([]);
  const [sendInvite, setSendInvite] = useState(true);
  const [result, setResult] = useState(null);
  const close = () => { setFile(null); setParseError(null); setCourseIds([]); setSendInvite(true); setResult(null); onClose(); };
  const run = useMutation({
    mutationFn: () => creatorLearnApi.importStudents({ rows: file.rows, courseIds, sendInvite }),
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['creator', 'students'] }); if (r.created || r.existing) toast.success(`${r.created} added, ${r.existing} already registered`); },
    onError: (e) => setParseError(e.details?.[0]?.message ?? e.message),
  });
  const pick = async (f) => {
    setParseError(null); setResult(null); setFile(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) { setParseError('Choose a .csv file. In Excel or Google Sheets use File → Download/Save as → CSV.'); return; }
    try {
      const rows = csvToStudents(parseCsv(await f.text()));
      if (!rows.length) throw new Error('The file has a header row but no students.');
      if (rows.length > MAX_IMPORT) throw new Error(`The file has ${rows.length} students. Import up to ${MAX_IMPORT} at a time.`);
      setFile({ name: f.name, rows });
    } catch (e) { setParseError(e.message); }
  };
  const downloadErrors = () => {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    saveBlob(new Blob([['row,email,reason', ...result.failed.map((f) => [f.row, esc(f.email), esc(f.reason)].join(','))].join('\n')], { type: 'text/csv' }), 'import-errors.csv');
  };
  return (
    <Modal open={open} onClose={close} size="lg" title="Import students" description="Upload a CSV with columns name, email and phone. Only email is required."
      footer={result
        ? <Button onClick={close}>Done</Button>
        : <><Button variant="secondary" onClick={close}>Cancel</Button><Button disabled={!file} loading={run.isPending} onClick={() => run.mutate()}>{file ? `Import ${file.rows.length} student${file.rows.length === 1 ? '' : 's'}` : 'Import'}</Button></>}>
      {result ? (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md border border-line p-3"><p className="text-2xl font-semibold">{result.created}</p><p className="text-muted">added</p></div>
            <div className="rounded-md border border-line p-3"><p className="text-2xl font-semibold">{result.existing}</p><p className="text-muted">already registered{courseIds.length ? ', enrolled' : ''}</p></div>
            <div className="rounded-md border border-line p-3"><p className="text-2xl font-semibold">{result.failed.length}</p><p className="text-muted">skipped</p></div>
          </div>
          {result.failed.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between"><p className="font-semibold">Skipped rows</p><Button size="sm" variant="secondary" leftIcon={Download} onClick={downloadErrors}>Download</Button></div>
              <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-md border border-line">
                {result.failed.map((f) => <li key={f.row} className="flex justify-between gap-3 px-3 py-2"><span>Row {f.row} · <span className="break-all">{f.email || '(blank)'}</span></span><span className="text-right text-muted">{f.reason}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-line-strong p-4">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            <Button variant="secondary" leftIcon={FileUp} onClick={() => fileRef.current?.click()}>{file ? 'Choose another file' : 'Choose CSV file'}</Button>
            <span className="text-sm text-muted">{file ? `${file.name} · ${file.rows.length} student${file.rows.length === 1 ? '' : 's'}` : 'Up to 1,000 students per file'}</span>
            <Button variant="ghost" size="sm" className="ml-auto" leftIcon={Download} onClick={() => saveBlob(new Blob([STUDENT_CSV_TEMPLATE], { type: 'text/csv' }), 'students-template.csv')}>Template</Button>
          </div>
          {parseError && <p role="alert" className="text-sm text-red-600">{parseError}</p>}
          {file && (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Phone</th></tr></thead>
                <tbody className="divide-y divide-line">{file.rows.slice(0, 5).map((r, i) => <tr key={i}><td className="px-3 py-2">{r.fullName || <span className="text-muted">—</span>}</td><td className="break-all px-3 py-2">{r.email}</td><td className="px-3 py-2">{r.phone}</td></tr>)}</tbody>
              </table>
              {file.rows.length > 5 && <p className="border-t border-line px-3 py-2 text-xs text-muted">and {file.rows.length - 5} more</p>}
            </div>
          )}
          <CoursePicker value={courseIds} onChange={setCourseIds} />
          <Checkbox label="Email new students a set-password link" description="Students who already have an account aren't emailed." checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
        </div>
      )}
    </Modal>
  );
}

function StudentDrawer({ id, onClose }) {
  const q = useQuery({ queryKey: ['creator', 'student', id], queryFn: () => creatorLearnApi.student(id), enabled: Boolean(id) });
  const s = q.data;
  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={s?.fullName ?? 'Student'}>
      {q.isLoading || !s ? <Skeleton className="h-40" /> : (
        <div className="space-y-5 text-sm">
          <dl className="grid grid-cols-3 gap-2"><dt className="text-muted">Email</dt><dd className="col-span-2 break-all">{s.email} {s.emailVerifiedAt ? <Badge tone="success">verified</Badge> : null}</dd><dt className="text-muted">Joined</dt><dd className="col-span-2">{formatDate(s.createdAt)}</dd><dt className="text-muted">Last sign-in</dt><dd className="col-span-2">{formatDate(s.lastLoginAt, { withTime: true })}</dd><dt className="text-muted">Submissions</dt><dd className="col-span-2">{s.submissions}</dd></dl>
          <div><p className="mb-2 font-semibold">Enrolments</p><ul className="space-y-2">{s.enrollments.map((e) => <li key={e.id} className="rounded-md border border-line p-3"><p className="font-medium">{e.course.title}</p><div className="mt-1 flex items-center justify-between text-xs text-muted"><StatusBadge status={e.status} /><span>{e.progressPercent}% · {e.source.toLowerCase()}</span></div></li>)}</ul></div>
          <div><p className="mb-2 font-semibold">Certificates</p>{s.certificates.length ? <ul className="space-y-1">{s.certificates.map((c) => <li key={c.id}>{c.courseTitle} · <span className="text-muted">{c.number}</span></li>)}</ul> : <p className="text-muted">None yet</p>}</div>
        </div>
      )}
    </Drawer>
  );
}

export function StudentsPage() {
  const [params, update] = useListParams();
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null); // 'add' | 'import'
  const canManage = useAuth().can('students.manage');
  const query = studentQuery(params);
  const q = useQuery({ queryKey: ['creator', 'students', query], queryFn: () => creatorLearnApi.students(query), placeholderData: (p) => p });
  const courses = useQuery({ queryKey: ['creator', 'courses', 'picker'], queryFn: () => coursesApi.list({ pageSize: 100, sort: 'title' }) });
  const filtered = Boolean(params.q || params.joined || params.active || params.courseId);
  return (
    <>
      <PageHeader title="Students" count={q.data?.meta?.total} description="Everyone with an account at your academy." breadcrumbs={[{ label: 'Students' }]}
        actions={canManage && <><Button variant="secondary" leftIcon={FileUp} onClick={() => setModal('import')}>Import CSV</Button><Button leftIcon={UserPlus} onClick={() => setModal('add')}>Add student</Button></>} />
      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <SearchInput value={params.q ?? ''} onChange={(v) => update({ q: v })} placeholder="Search by name or email" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Filter by:</span>
            <FilterChip label="Date joined" value={params.joined} onChange={(v) => update({ joined: v })} options={JOINED} />
            <FilterChip label="Last sign-in" value={params.active} onChange={(v) => update({ active: v })} options={ACTIVE} />
            <FilterChip label="Course" value={params.courseId} onChange={(v) => update({ courseId: v })} options={(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }))} panelClassName="w-72" />
            {filtered && <button type="button" className="ml-1 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300" onClick={() => update({ q: undefined, joined: undefined, active: undefined, courseId: undefined })}>Reset</button>}
          </div>
        </div>
        <DataTable loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rows={q.data?.items ?? []} meta={q.data?.meta} onPageChange={(page) => update({ page }, { resetPage: false })} onPageSizeChange={(pageSize) => update({ pageSize })} onRowClick={(r) => setSelected(r.id)}
          empty={filtered ? <EmptyState icon={GraduationCap} title="No students match" description="Try a different search or clear the filters." /> : <EmptyState icon={GraduationCap} title="No students yet" description="Students appear here when they register, or add them yourself." action={canManage && <Button leftIcon={UserPlus} onClick={() => setModal('add')}>Add student</Button>} />}
          columns={[
            { key: 'fullName', header: 'Student', cell: (r) => <div className="flex items-center gap-3"><Avatar name={r.fullName || r.email} size="sm" /><div className="min-w-0"><p className="truncate font-medium text-fg">{r.fullName || r.email.split('@')[0]}</p><p className="truncate text-xs text-muted">{r.email}</p></div></div> },
            { key: 'phone', header: 'Phone', cell: (r) => r.phone ?? <span className="text-muted">—</span> },
            { key: 'enrollmentCount', header: 'Courses', align: 'right' },
            { key: 'lastLoginAt', header: 'Last sign-in', cell: (r) => <TwoLineDate value={r.lastLoginAt} /> },
            { key: 'createdAt', header: 'Joined', cell: (r) => <TwoLineDate value={r.createdAt} /> },
          ]} />
      </Card>
      <StudentDrawer id={selected} onClose={() => setSelected(null)} />
      <AddStudentModal open={modal === 'add'} onClose={() => setModal(null)} />
      <ImportStudentsModal open={modal === 'import'} onClose={() => setModal(null)} />
    </>
  );
}
