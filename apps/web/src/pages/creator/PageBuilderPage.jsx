import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, Copy, ExternalLink, Eye, EyeOff, GripVertical, History, Monitor, MoreHorizontal, Redo2, Settings2, Smartphone, Trash2, Undo2 } from 'lucide-react';
import { Alert } from '../../components/auth/Alert.jsx';
import { Badge, Button, ConfirmDialog, Dropdown, DropdownItem, DropdownSeparator, Input, Modal, Skeleton, Switch, Textarea, toast } from '../../components/ui/index.js';
import { BLOCK_DEFS, BLOCK_TYPES, BlockView, newBlockId } from '../../components/site/blocks.jsx';
import { BlockFields } from '../../components/site/BlockFields.jsx';
import { websiteApi } from '../../services/api/website.js';
import { workspaceApi } from '../../services/api/auth.js';
import { academyApi2, coursesApi } from '../../services/api/creator.js';
import { cn } from '../../utils/cn.js';
import { formatDate } from '../../utils/format.js';

const MAX_BLOCKS = 60;
const MAX_HISTORY = 100;
const GROUP_MS = 800;

/**
 * Undo/redo over the block list. Typing into the same field is grouped into one step
 * (changes within GROUP_MS with the same `group` key replace the last entry).
 */
function historyReducer(state, action) {
  switch (action.type) {
    case 'reset':
      return { past: [], present: action.blocks, future: [], lastGroup: null, lastAt: 0 };
    case 'set': {
      const now = Date.now();
      const merge = action.group && action.group === state.lastGroup && now - state.lastAt < GROUP_MS;
      return {
        past: merge ? state.past : [...state.past, state.present].slice(-MAX_HISTORY),
        present: action.blocks, future: [], lastGroup: action.group ?? null, lastAt: now,
      };
    }
    case 'undo':
      if (!state.past.length) return state;
      return { past: state.past.slice(0, -1), present: state.past.at(-1), future: [state.present, ...state.future], lastGroup: null, lastAt: 0 };
    case 'redo':
      if (!state.future.length) return state;
      return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1), lastGroup: null, lastAt: 0 };
    default:
      return state;
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/** API errors are addressed as blocks.<index>.props.<field>…; map them to block id → field → message. */
function errorsByBlock(details, blocks) {
  const out = {};
  for (const e of details ?? []) {
    const m = /^blocks\.(\d+)\.props\.([^.]+)/.exec(e.field ?? '');
    const b = m ? blocks[Number(m[1])] : null;
    if (b) (out[b.id] ??= {})[m[2]] = e.message;
  }
  return out;
}

// ── Palette ──────────────────────────────────────────────────

function PaletteItem({ type, onAdd }) {
  const def = BLOCK_DEFS[type];
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${type}`, data: { from: 'palette', type } });
  const Icon = def.icon;
  return (
    <button ref={setNodeRef} type="button" {...listeners} {...attributes} onClick={() => onAdd(type)} aria-label={`Add ${def.label} block`}
      className={cn('flex w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left text-sm hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-950', isDragging && 'opacity-50')}>
      <Icon className="size-4 shrink-0 text-muted" aria-hidden />{def.label}
    </button>
  );
}

// ── Canvas ───────────────────────────────────────────────────

function CanvasBlock({ block, selected, errors, data, theme, onSelect, onToggle, onDuplicate, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, data: { from: 'canvas' } });
  const def = BLOCK_DEFS[block.type];
  const hasError = errors && Object.keys(errors).length > 0;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-testid={`canvas-block-${block.type}`}
      className={cn('group relative outline-offset-[-2px]', selected ? 'outline-2 outline-primary-600' : 'hover:outline-1 hover:outline-primary-300', hasError && 'outline-2 outline-red-500', isDragging && 'z-10 opacity-70', block.hidden && 'opacity-50')}
      onClick={() => onSelect(block.id)}>
      <div className={cn('absolute top-2 left-2 z-10 flex items-center gap-1 rounded-md bg-surface/95 px-1 py-0.5 shadow-sm ring-1 ring-line', selected ? 'flex' : 'hidden group-hover:flex group-focus-within:flex')}>
        <button type="button" className="cursor-grab p-1 text-muted hover:text-fg active:cursor-grabbing" aria-label={`Drag ${def?.label ?? 'block'} to reorder`} {...listeners} {...attributes}><GripVertical className="size-4" /></button>
        <span className="px-1 text-xs font-medium">{def?.label}</span>
        {block.hidden && <Badge>Hidden</Badge>}
        <button type="button" className="p-1 text-muted hover:text-fg" aria-label={block.hidden ? 'Show block' : 'Hide block'} onClick={(e) => { e.stopPropagation(); onToggle(); }}>{block.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
        <button type="button" className="p-1 text-muted hover:text-fg" aria-label="Duplicate block" onClick={(e) => { e.stopPropagation(); onDuplicate(); }}><Copy className="size-4" /></button>
        <button type="button" className="p-1 text-muted hover:text-red-600" aria-label="Delete block" onClick={(e) => { e.stopPropagation(); onRemove(); }}><Trash2 className="size-4" /></button>
      </div>
      <div className="pointer-events-none"><BlockView block={block} data={data} theme={theme} editing /></div>
    </div>
  );
}

function CanvasDropZone({ children, empty }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas:end' });
  return (
    <div ref={setNodeRef} className={cn('min-h-full', isOver && 'bg-primary-50/40')}>
      {children}
      <div className={cn('m-4 rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted', isOver ? 'border-primary-500 text-primary-600' : 'border-line')}>
        {empty ? 'Drag a block here from the left, or click one to add it.' : 'Drop here to add at the end'}
      </div>
    </div>
  );
}

// ── Page settings ────────────────────────────────────────────

function SettingsDialog({ open, page, value, onChange, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Page settings">
      <div className="space-y-4">
        <Input label="Title" value={value.title} maxLength={120} onChange={(e) => onChange({ ...value, title: e.target.value })} />
        {!page?.isHome && <Input label="Address" value={value.slug} maxLength={80} onChange={(e) => onChange({ ...value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} hint={`Visitors open /p/${value.slug || '…'}`} />}
        {!page?.isHome && <Switch label="Show in the site menu" checked={value.showInNav} onChange={(showInNav) => onChange({ ...value, showInNav })} />}
        <Input label="Search engine title" value={value.seoTitle} maxLength={70} hint={`${value.seoTitle.length}/70`} onChange={(e) => onChange({ ...value, seoTitle: e.target.value })} />
        <Textarea label="Search engine description" rows={2} value={value.seoDescription} maxLength={170} hint={`${value.seoDescription.length}/170`} onChange={(e) => onChange({ ...value, seoDescription: e.target.value })} />
        <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
      </div>
    </Modal>
  );
}

// ── Builder ──────────────────────────────────────────────────

export function PageBuilderPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['website', 'page', id], queryFn: () => websiteApi.page(id) });
  const versions = useQuery({ queryKey: ['website', 'versions', id], queryFn: () => websiteApi.versions(id) });
  const courses = useQuery({ queryKey: ['creator', 'courses', 'all'], queryFn: () => coursesApi.list({ pageSize: 100 }) });
  const academy = useQuery({ queryKey: ['creator', 'academy'], queryFn: academyApi2.get, staleTime: 5 * 60_000 });
  const ws = useQuery({ queryKey: ['workspace'], queryFn: workspaceApi.workspace });
  const academyUrl = ws.data?.primaryHostname ? `${window.location.protocol}//${ws.data.primaryHostname}${window.location.port ? `:${window.location.port}` : ''}` : null;

  const [hist, dispatch] = useReducer(historyReducer, { past: [], present: null, future: [], lastGroup: null, lastAt: 0 });
  const blocks = hist.present;
  const [meta, setMeta] = useState(null);
  const [saved, setSaved] = useState({ blocks: null, meta: null });
  const [files, setFiles] = useState({});
  const [selected, setSelected] = useState(null);
  const [errors, setErrors] = useState({});
  const [pageErrors, setPageErrors] = useState([]);
  const [device, setDevice] = useState('desktop');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [dragType, setDragType] = useState(null);
  const loaded = useRef(null);

  const load = useCallback((p) => {
    const m = { title: p.title, slug: p.slug, showInNav: p.showInNav, seoTitle: p.seoTitle ?? '', seoDescription: p.seoDescription ?? '' };
    dispatch({ type: 'reset', blocks: clone(p.draftBlocks) });
    setMeta(m);
    setSaved({ blocks: JSON.stringify(p.draftBlocks), meta: JSON.stringify(m) });
    setFiles(p.files ?? {});
    setErrors({});
    setPageErrors([]);
  }, []);
  useEffect(() => {
    if (q.data && loaded.current !== q.data.id) { loaded.current = q.data.id; load(q.data); }
  }, [q.data, load]);

  const dirty = blocks !== null && meta !== null && (JSON.stringify(blocks) !== saved.blocks || JSON.stringify(meta) !== saved.meta);
  // Warn before leaving with unsaved changes (in-app navigation and tab close).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    const onBeforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const published = useMemo(() => (courses.data?.items ?? []).filter((c) => c.status === 'PUBLISHED'), [courses.data]);
  const theme = { primaryColor: academy.data?.primaryColor ?? '#4f46e5', fontHeading: academy.data?.fontHeading, fontBody: academy.data?.fontBody };
  const data = useMemo(() => {
    const cards = (b) => {
      const list = b.props.mode === 'selected' ? (b.props.courseIds ?? []).map((cid) => published.find((c) => c.id === cid)).filter(Boolean) : published.slice(0, b.props.limit ?? 6);
      return list.map((c) => ({ id: c.id, slug: c.slug, title: c.title, shortDescription: c.shortDescription, isFree: c.isFree, priceAmount: c.priceAmount, currency: c.currency, thumbnailUrl: c.thumbnailUrl ?? null }));
    };
    return { files, courses: Object.fromEntries((blocks ?? []).filter((b) => b.type === 'courseGrid').map((b) => [b.id, cards(b)])) };
  }, [blocks, files, published]);

  const set = (next, group) => dispatch({ type: 'set', blocks: next, group });
  const add = (type, index) => {
    if (blocks.length >= MAX_BLOCKS) return toast.error(`A page can have at most ${MAX_BLOCKS} blocks`);
    const b = { id: newBlockId(), type, hidden: false, props: clone(BLOCK_DEFS[type].defaults) };
    const at = index ?? (selected ? blocks.findIndex((x) => x.id === selected) + 1 : blocks.length);
    set([...blocks.slice(0, at), b, ...blocks.slice(at)]);
    setSelected(b.id);
  };
  const update = (blockId, patch, group) => set(blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)), group);
  const remove = (blockId) => { set(blocks.filter((b) => b.id !== blockId)); if (selected === blockId) setSelected(null); };
  const duplicate = (blockId) => {
    const i = blocks.findIndex((b) => b.id === blockId);
    const copy = { ...clone(blocks[i]), id: newBlockId() };
    set([...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)]);
    setSelected(copy.id);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  // New blocks land where the pointer is (above or below the block under it); reordering uses closest centre.
  const collision = (args) => {
    if (args.active.data.current?.from !== 'palette') return closestCenter(args);
    const hits = pointerWithin(args);
    return hits.length ? hits : closestCenter(args);
  };
  const onDragEnd = ({ active, over, activatorEvent, delta }) => {
    setDragType(null);
    if (!over) return;
    if (active.data.current?.from === 'palette') {
      let at = over.id === 'canvas:end' ? blocks.length : blocks.findIndex((b) => b.id === over.id);
      if (at < 0) at = blocks.length;
      else if (over.id !== 'canvas:end' && activatorEvent && 'clientY' in activatorEvent) {
        const y = activatorEvent.clientY + delta.y;
        if (y > over.rect.top + over.rect.height / 2) at += 1;
      }
      add(active.data.current.type, at);
      return;
    }
    if (active.id !== over.id && over.id !== 'canvas:end') {
      set(arrayMove(blocks, blocks.findIndex((b) => b.id === active.id), blocks.findIndex((b) => b.id === over.id)));
    }
  };

  const body = () => ({ draftBlocks: blocks, title: meta.title.trim(), ...(q.data?.isHome ? {} : { slug: meta.slug, showInNav: meta.showInNav }), seoTitle: meta.seoTitle.trim() || null, seoDescription: meta.seoDescription.trim() || null });
  const onSaved = (p) => {
    qc.setQueryData(['website', 'page', id], p);
    qc.invalidateQueries({ queryKey: ['website', 'overview'] });
    setSaved({ blocks: JSON.stringify(blocks), meta: JSON.stringify(meta) });
    setFiles((f) => ({ ...f, ...(p.files ?? {}) }));
    setErrors({});
    setPageErrors([]);
  };
  const onError = (e) => {
    const byBlock = errorsByBlock(e.details, blocks);
    setErrors(byBlock);
    setPageErrors((e.details ?? []).filter((d) => !/^blocks\.\d+\.props/.test(d.field ?? '')).map((d) => d.message));
    const first = Object.keys(byBlock)[0];
    if (first) setSelected(first);
    toast.error(e.message);
  };
  const save = useMutation({ mutationFn: () => websiteApi.savePage(id, body()), onSuccess: (p) => { onSaved(p); toast.success('Draft saved'); }, onError });
  const publish = useMutation({ mutationFn: async () => { await websiteApi.savePage(id, body()); return websiteApi.publish(id, null); }, onSuccess: (p) => { onSaved(p); versions.refetch(); toast.success('Page published'); }, onError });
  const unpublish = useMutation({ mutationFn: () => websiteApi.unpublish(id), onSuccess: (p) => { qc.setQueryData(['website', 'page', id], p); qc.invalidateQueries({ queryKey: ['website', 'overview'] }); setConfirmUnpublish(false); toast.success('Page unpublished'); }, onError: (e) => toast.error(e.message) });
  const restore = useMutation({ mutationFn: (versionId) => websiteApi.restore(id, versionId), onSuccess: (p) => { qc.setQueryData(['website', 'page', id], p); load(p); toast.success('Version copied into the draft'); }, onError: (e) => toast.error(e.message) });
  const preview = useMutation({ mutationFn: async () => { await websiteApi.savePage(id, body()); return websiteApi.previewToken(); }, onSuccess: ({ token }) => { setSaved({ blocks: JSON.stringify(blocks), meta: JSON.stringify(meta) }); window.open(`${academyUrl}${q.data.isHome ? '/' : `/p/${meta.slug}`}?preview=${encodeURIComponent(token)}`, '_blank', 'noopener'); }, onError });

  // Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, Ctrl/Cmd+S save.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); if (dirty && !save.isPending) save.mutate(); return; }
      const inField = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (inField) return; // let fields keep their own undo
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'undo' }); } else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); dispatch({ type: 'redo' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, save]);

  if (q.isError) return <Alert tone="error" title="Page not found">{q.error.message}</Alert>;
  if (!blocks || !meta) return <Skeleton className="h-[70vh]" />;
  const page = q.data;
  const sel = blocks.find((b) => b.id === selected);
  const status = !page.publishedAt ? 'Draft' : dirty || page.hasUnpublishedChanges ? 'Unpublished changes' : 'Published';

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] flex-col sm:-mx-6 lg:-mx-8">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <Link to="/creator/website" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" />Website</Link>
        <span className="mx-2 h-5 w-px bg-line" aria-hidden />
        <h1 className="truncate font-semibold">{meta.title || 'Untitled page'}</h1>
        <Badge tone={status === 'Published' ? 'success' : status === 'Draft' ? 'neutral' : 'warning'}>{status}</Badge>
        {page.isHome && <Badge tone="primary">Home</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!hist.past.length} onClick={() => dispatch({ type: 'undo' })}><Undo2 className="size-4" /></Button>
          <Button size="icon-sm" variant="ghost" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!hist.future.length} onClick={() => dispatch({ type: 'redo' })}><Redo2 className="size-4" /></Button>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <Button size="icon-sm" variant={device === 'desktop' ? 'secondary' : 'ghost'} aria-label="Desktop view" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}><Monitor className="size-4" /></Button>
          <Button size="icon-sm" variant={device === 'mobile' ? 'secondary' : 'ghost'} aria-label="Mobile view" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}><Smartphone className="size-4" /></Button>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <Button size="sm" variant="ghost" leftIcon={Settings2} onClick={() => setSettingsOpen(true)}>Settings</Button>
          {academyUrl && <Button size="sm" variant="ghost" leftIcon={ExternalLink} loading={preview.isPending} onClick={() => preview.mutate()}>Preview</Button>}
          <Button size="sm" variant="secondary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{dirty ? 'Save draft' : 'Saved'}</Button>
          <Button size="sm" loading={publish.isPending} onClick={() => publish.mutate()}>Publish</Button>
          <Dropdown trigger={(t) => <Button size="icon-sm" variant="ghost" aria-label="More page actions" {...t}><MoreHorizontal className="size-4" /></Button>}>
            {(versions.data ?? []).slice(0, 10).map((v) => <DropdownItem key={v.id} icon={History} onClick={() => restore.mutate(v.id)}>Restore {v.note ?? 'version'} · {formatDate(v.createdAt, { withTime: true })}</DropdownItem>)}
            {(versions.data ?? []).length > 0 && <DropdownSeparator />}
            {page.publishedAt && <DropdownItem danger onClick={() => setConfirmUnpublish(true)}>Unpublish page</DropdownItem>}
          </Dropdown>
        </div>
      </div>
      {pageErrors.length > 0 && <Alert tone="error" className="m-3">{pageErrors.join(' · ')}</Alert>}

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={({ active }) => setDragType(active.data.current?.type ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragType(null)}>
        <div className="flex min-h-0 flex-1">
          {/* Palette */}
          <aside className="hidden w-52 shrink-0 space-y-1.5 overflow-y-auto border-r border-line bg-surface-2 p-3 md:block" aria-label="Blocks">
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Add a block</p>
            {BLOCK_TYPES.map((t) => <PaletteItem key={t} type={t} onAdd={(type) => add(type)} />)}
          </aside>
          {/* Canvas */}
          <main className="min-w-0 flex-1 overflow-y-auto bg-surface-2 p-4" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
            <div className={cn('mx-auto overflow-hidden rounded-lg bg-surface shadow-sm ring-1 ring-line transition-[max-width]', device === 'mobile' ? 'max-w-[390px]' : 'max-w-6xl')} style={{ fontFamily: theme.fontBody }} data-testid="builder-canvas">
              <CanvasDropZone empty={!blocks.length}>
                <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  {blocks.map((b) => (
                    <CanvasBlock key={b.id} block={b} selected={selected === b.id} errors={errors[b.id]} data={data} theme={theme}
                      onSelect={setSelected} onToggle={() => update(b.id, { hidden: !b.hidden })} onDuplicate={() => duplicate(b.id)} onRemove={() => remove(b.id)} />
                  ))}
                </SortableContext>
              </CanvasDropZone>
            </div>
            {/* Small screens: add blocks from a menu instead of the side palette. */}
            <div className="mt-3 md:hidden">
              <Dropdown trigger={(t) => <Button variant="secondary" className="w-full" {...t}>Add a block</Button>}>
                {BLOCK_TYPES.map((t) => <DropdownItem key={t} onClick={() => add(t)}>{BLOCK_DEFS[t].label}</DropdownItem>)}
              </Dropdown>
            </div>
          </main>
          {/* Inspector */}
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-line bg-surface p-4 lg:block xl:w-96" aria-label="Block settings">
            {sel ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold">{BLOCK_DEFS[sel.type]?.label}</h2>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
                </div>
                {sel.type === 'testimonials' && <Alert tone="info" className="mb-3">Use real quotes from your students, with their permission.</Alert>}
                <BlockFields block={sel} courses={published} files={files} errors={errors[sel.id]}
                  onChange={(props, newFiles) => { if (newFiles) setFiles((f) => ({ ...f, ...newFiles })); update(sel.id, { props }, `${sel.id}`); }} />
              </>
            ) : (
              <div className="text-sm text-muted">
                <p className="font-medium text-fg">Select a block to edit it</p>
                <p className="mt-2">Click any block on the page. Drag blocks by their handle to reorder, or drag new ones in from the left.</p>
                <p className="mt-2">Shortcuts: Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+S save.</p>
              </div>
            )}
          </aside>
        </div>
        <DragOverlay>{dragType ? <div className="rounded-md border border-primary-500 bg-surface px-3 py-2 text-sm shadow-lg">{BLOCK_DEFS[dragType]?.label}</div> : null}</DragOverlay>
      </DndContext>

      {/* Small screens: inspector as a dialog. */}
      <Modal open={Boolean(sel) && typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1023px)').matches} onClose={() => setSelected(null)} title={sel ? BLOCK_DEFS[sel.type]?.label : ''}>
        {sel && <BlockFields block={sel} courses={published} files={files} errors={errors[sel.id]} onChange={(props, newFiles) => { if (newFiles) setFiles((f) => ({ ...f, ...newFiles })); update(sel.id, { props }, `${sel.id}`); }} />}
      </Modal>
      <SettingsDialog open={settingsOpen} page={page} value={meta} onChange={setMeta} onClose={() => setSettingsOpen(false)} />
      <ConfirmDialog open={confirmUnpublish} onClose={() => setConfirmUnpublish(false)} onConfirm={() => unpublish.mutate()} loading={unpublish.isPending} title="Unpublish this page?" description="Visitors will no longer see it. Your draft is kept." confirmLabel="Unpublish" />
      <ConfirmDialog open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} onConfirm={() => blocker.proceed?.()} title="Leave without saving?" description="Your unsaved changes to this page will be lost." confirmLabel="Leave page" />
    </div>
  );
}
