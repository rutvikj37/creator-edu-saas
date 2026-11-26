import { useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AudioLines, ChevronDown, ChevronRight, CornerDownRight, Download, File, FileText, GripVertical, Image, Link2, MoreHorizontal, Plus, Radio, ClipboardCheck, PenSquare, Trash2, Video } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Dropdown, DropdownItem, DropdownSeparator, Input, Modal, toast } from '../../components/ui/index.js';
import { coursesApi } from '../../services/api/creator.js';
import { cn } from '../../utils/cn.js';

export const LESSON_TYPES = [
  { value: 'VIDEO', label: 'Video', icon: Video, primary: true },
  { value: 'TEXT', label: 'Text', icon: FileText, primary: true },
  { value: 'QUIZ', label: 'Quiz', icon: ClipboardCheck, primary: true },
  { value: 'PDF', label: 'PDF', icon: File },
  { value: 'DOCUMENT', label: 'Document', icon: File },
  { value: 'IMAGE', label: 'Image', icon: Image },
  { value: 'AUDIO', label: 'Audio', icon: AudioLines },
  { value: 'DOWNLOAD', label: 'Download', icon: Download },
  { value: 'LINK', label: 'External link', icon: Link2 },
  { value: 'ASSIGNMENT', label: 'Assignment', icon: PenSquare },
  { value: 'LIVE', label: 'Live class', icon: Radio },
];
const TYPE_BY = Object.fromEntries(LESSON_TYPES.map((t) => [t.value, t]));
const PRIMARY_TYPES = LESSON_TYPES.filter((t) => t.primary);
const MORE_TYPES = LESSON_TYPES.filter((t) => !t.primary);

/** Converts the curriculum tree to the reorder payload the API expects. */
export function toOrderPayload(sections) {
  return sections.map((s) => ({ id: s.id, lessons: s.lessons.map((l) => ({ id: l.id, children: (l.children ?? []).map((c) => c.id) })) }));
}

function Sortable({ id, children, className }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(className, isDragging && 'relative z-10 opacity-80 shadow-lg')}>
      {children({ handle: { ...attributes, ...listeners } })}
    </div>
  );
}

function LessonRow({ lesson, handle, onEdit, onMenu, sub }) {
  const T = TYPE_BY[lesson.type] ?? { icon: FileText, label: lesson.type };
  return (
    <div className={cn('flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-2', sub && 'ml-8')}>
      {handle ? <button type="button" className="cursor-grab text-muted hover:text-fg" aria-label={`Reorder ${lesson.title}`} {...handle}><GripVertical className="size-4" /></button> : <CornerDownRight className="size-4 text-muted" aria-hidden />}
      <T.icon className="size-4 text-muted" aria-hidden />
      <button type="button" onClick={() => onEdit(lesson)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-primary-700">{lesson.title}</button>
      {lesson.isFreePreview && <Badge tone="info">Preview</Badge>}
      {!lesson.isPublished && <Badge>Draft</Badge>}
      {onMenu}
    </div>
  );
}

/**
 * Drag-and-drop curriculum editor. Sections and top-level lessons are sortable with mouse,
 * touch or keyboard (space to lift, arrows to move). Order is saved to the server immediately.
 */
export function CurriculumBuilder({ courseId, sections, onChange, onEditLesson, readOnly, dripType = 'NONE' }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [collapsed, setCollapsed] = useState({});
  const [adding, setAdding] = useState(null); // { sectionId, parentLessonId? }
  const [newLesson, setNewLesson] = useState({ title: '', type: 'VIDEO' });
  const [showMoreTypes, setShowMoreTypes] = useState(false);
  const [sectionTitle, setSectionTitle] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections]);

  const persist = async (next) => {
    const prev = sections;
    onChange(next); // optimistic
    try {
      onChange(await coursesApi.reorder(courseId, toOrderPayload(next)));
    } catch (e) {
      onChange(prev);
      toast.error(e.message);
    }
  };

  const onSectionDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    persist(arrayMove(sections, sectionIds.indexOf(active.id), sectionIds.indexOf(over.id)));
  };
  const onLessonDragEnd = (sectionId) => ({ active, over }) => {
    if (!over || active.id === over.id) return;
    persist(sections.map((s) => (s.id !== sectionId ? s : { ...s, lessons: arrayMove(s.lessons, s.lessons.findIndex((l) => l.id === active.id), s.lessons.findIndex((l) => l.id === over.id)) })));
  };

  const moveLesson = (lesson, fromSectionId, toSectionId) => {
    const moving = sections.find((s) => s.id === fromSectionId).lessons.find((l) => l.id === lesson.id);
    persist(sections.map((s) => {
      if (s.id === fromSectionId) return { ...s, lessons: s.lessons.filter((l) => l.id !== lesson.id) };
      if (s.id === toSectionId) return { ...s, lessons: [...s.lessons, moving] };
      return s;
    }));
  };

  const nest = (lesson, sectionId) => {
    const sec = sections.find((s) => s.id === sectionId);
    const idx = sec.lessons.findIndex((l) => l.id === lesson.id);
    if (idx <= 0 || (lesson.children ?? []).length) return toast.error('Move a lesson without sub-lessons below another lesson to nest it.');
    const parent = sec.lessons[idx - 1];
    persist(sections.map((s) => (s.id !== sectionId ? s : { ...s, lessons: s.lessons.filter((l) => l.id !== lesson.id).map((l) => (l.id === parent.id ? { ...l, children: [...(l.children ?? []), { ...lesson, children: [] }] } : l)) })));
  };
  const unnest = (child, parent, sectionId) => {
    persist(sections.map((s) => {
      if (s.id !== sectionId) return s;
      const lessons = [];
      for (const l of s.lessons) {
        if (l.id === parent.id) { lessons.push({ ...l, children: l.children.filter((c) => c.id !== child.id) }, { ...child, children: [] }); } else lessons.push(l);
      }
      return { ...s, lessons };
    }));
  };

  const reload = async () => onChange(await coursesApi.curriculum(courseId));
  const addSection = async () => {
    setBusy(true);
    try { await coursesApi.addSection(courseId, { title: sectionTitle }); setSectionTitle(''); await reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const addLesson = async () => {
    setBusy(true);
    try {
      const l = await coursesApi.addLesson(courseId, { sectionId: adding.sectionId, parentLessonId: adding.parentLessonId, ...newLesson });
      setAdding(null);
      setNewLesson({ title: '', type: 'VIDEO' });
      setShowMoreTypes(false);
      await reload();
      onEditLesson(l);
    } catch (e) { toast.error(e.details?.[0]?.message ?? e.message); } finally { setBusy(false); }
  };
  const renameSection = async () => {
    try {
      const body = { title: renaming.title };
      if (dripType === 'DAYS_AFTER_ENROLL') body.dripOffsetDays = renaming.dripOffsetDays === '' || renaming.dripOffsetDays == null ? null : Number(renaming.dripOffsetDays);
      if (dripType === 'DATE') body.unlockAt = renaming.unlockAt ? new Date(`${renaming.unlockAt}T00:00:00`).toISOString() : null;
      await coursesApi.updateSection(courseId, renaming.id, body);
      setRenaming(null);
      await reload();
    } catch (e) { toast.error(e.message); }
  };
  const dripLabel = (section) => {
    if (dripType === 'DAYS_AFTER_ENROLL' && section.dripOffsetDays != null) return `Day ${section.dripOffsetDays}`;
    if (dripType === 'DATE' && section.unlockAt) return `Unlocks ${String(section.unlockAt).slice(0, 10)}`;
    return null;
  };
  const confirmDelete = async () => {
    try {
      if (toDelete.kind === 'section') await coursesApi.removeSection(courseId, toDelete.item.id);
      else await coursesApi.removeLesson(courseId, toDelete.item.id);
      setToDelete(null);
      await reload();
      toast.success('Deleted');
    } catch (e) { toast.error(e.message); }
  };

  const lessonMenu = (lesson, section, parent) => readOnly ? null : (
    <Dropdown trigger={(p) => <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${lesson.title}`} {...p}><MoreHorizontal className="size-4" /></Button>}>
      <DropdownItem onClick={() => onEditLesson(lesson)}>Edit lesson</DropdownItem>
      {!parent && <DropdownItem onClick={() => { setAdding({ sectionId: section.id, parentLessonId: lesson.id }); setNewLesson({ title: '', type: 'VIDEO' }); setShowMoreTypes(false); }}>Add sub-lesson</DropdownItem>}
      {!parent && <DropdownItem onClick={() => nest(lesson, section.id)}>Make sub-lesson of previous</DropdownItem>}
      {parent && <DropdownItem onClick={() => unnest(lesson, parent, section.id)}>Move out of “{parent.title}”</DropdownItem>}
      {!parent && sections.length > 1 && <DropdownSeparator />}
      {!parent && sections.filter((s) => s.id !== section.id).map((s) => <DropdownItem key={s.id} onClick={() => moveLesson(lesson, section.id, s.id)}>Move to “{s.title}”</DropdownItem>)}
      <DropdownSeparator />
      <DropdownItem danger icon={Trash2} onClick={() => setToDelete({ kind: 'lesson', item: lesson })}>Delete</DropdownItem>
    </Dropdown>
  );

  return (
    <div className="space-y-4">
      {!readOnly && sections.length === 0 && (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface-2/40 px-6 py-10 text-center">
          <p className="text-base font-semibold text-fg">Add your first section</p>
          <p className="mt-1 text-sm text-muted">Sections group lessons (e.g. “Week 1” or “Getting started”).</p>
          <form className="mx-auto mt-5 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (sectionTitle.trim()) addSection(); }}>
            <Input aria-label="First section title" placeholder="e.g. Introduction" value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} autoFocus />
            <Button type="submit" leftIcon={Plus} loading={busy && !adding} disabled={!sectionTitle.trim()}>Add section</Button>
          </form>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
        <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
          {sections.map((section, si) => (
            <Sortable key={section.id} id={section.id} className="rounded-lg border border-line bg-surface-2/40">
              {({ handle }) => (
                <>
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    {!readOnly && <button type="button" className="cursor-grab text-muted hover:text-fg" aria-label={`Reorder section ${section.title}`} {...handle}><GripVertical className="size-4" /></button>}
                    <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [section.id]: !c[section.id] }))} aria-expanded={!collapsed[section.id]} className="text-muted">
                      {collapsed[section.id] ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                    </button>
                    <p className="flex-1 text-sm font-semibold">Section {si + 1}: {section.title}</p>
                    {dripLabel(section) && <Badge tone="info">{dripLabel(section)}</Badge>}
                    <span className="text-xs text-muted">{section.lessons.reduce((n, l) => n + 1 + (l.children?.length ?? 0), 0)} lessons</span>
                    {!readOnly && (
                      <Dropdown trigger={(p) => <Button variant="ghost" size="icon-sm" aria-label={`Actions for section ${section.title}`} {...p}><MoreHorizontal className="size-4" /></Button>}>
                        <DropdownItem onClick={() => setRenaming({
                          id: section.id,
                          title: section.title,
                          dripOffsetDays: section.dripOffsetDays ?? '',
                          unlockAt: section.unlockAt ? String(section.unlockAt).slice(0, 10) : '',
                        })}>{dripType !== 'NONE' ? 'Edit section' : 'Rename'}</DropdownItem>
                        <DropdownItem danger icon={Trash2} onClick={() => setToDelete({ kind: 'section', item: section })}>Delete section</DropdownItem>
                      </Dropdown>
                    )}
                  </div>
                  {!collapsed[section.id] && (
                    <div className="space-y-2 px-3 pb-3">
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onLessonDragEnd(section.id)}>
                        <SortableContext items={section.lessons.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                          {section.lessons.map((lesson) => (
                            <Sortable key={lesson.id} id={lesson.id} className="space-y-2">
                              {({ handle }) => (
                                <>
                                  <LessonRow lesson={lesson} handle={readOnly ? null : handle} onEdit={onEditLesson} onMenu={lessonMenu(lesson, section)} />
                                  {(lesson.children ?? []).map((child) => <LessonRow key={child.id} sub lesson={child} onEdit={onEditLesson} onMenu={lessonMenu(child, section, lesson)} />)}
                                </>
                              )}
                            </Sortable>
                          ))}
                        </SortableContext>
                      </DndContext>
                      {section.lessons.length === 0 && (
                        <div className="rounded-md border border-dashed border-line px-3 py-4 text-center">
                          <p className="text-sm text-muted">No lessons yet — start with a video or text lesson.</p>
                          {!readOnly && (
                            <Button className="mt-3" size="sm" leftIcon={Plus} onClick={() => { setAdding({ sectionId: section.id }); setNewLesson({ title: '', type: 'VIDEO' }); setShowMoreTypes(false); }}>
                              Add first lesson
                            </Button>
                          )}
                        </div>
                      )}
                      {!readOnly && section.lessons.length > 0 && (
                        <Button variant="ghost" size="sm" leftIcon={Plus} onClick={() => { setAdding({ sectionId: section.id }); setNewLesson({ title: '', type: 'VIDEO' }); setShowMoreTypes(false); }}>Add lesson</Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </Sortable>
          ))}
        </SortableContext>
      </DndContext>
      {!readOnly && sections.length > 0 && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (sectionTitle.trim()) addSection(); }}>
          <Input aria-label="New section title" placeholder="New section title" value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} />
          <Button type="submit" variant="secondary" leftIcon={Plus} loading={busy && !adding} disabled={!sectionTitle.trim()}>Add section</Button>
        </form>
      )}

      <Modal open={Boolean(adding)} onClose={() => setAdding(null)} title={adding?.parentLessonId ? 'Add sub-lesson' : 'Add lesson'}
        footer={<><Button variant="secondary" onClick={() => setAdding(null)}>Cancel</Button><Button disabled={!newLesson.title.trim()} loading={busy} onClick={addLesson}>Add and edit</Button></>}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (newLesson.title.trim()) addLesson(); }}>
          <Input label="Lesson title" autoFocus value={newLesson.title} onChange={(e) => setNewLesson({ ...newLesson, title: e.target.value })} />
          <div>
            <p className="mb-2 text-sm font-medium text-fg-2">Type</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Lesson type">
              {(showMoreTypes ? LESSON_TYPES : PRIMARY_TYPES).map((t) => (
                <button key={t.value} type="button" role="radio" aria-checked={newLesson.type === t.value} disabled={Boolean(t.soon)}
                  onClick={() => setNewLesson({ ...newLesson, type: t.value })}
                  className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm', newLesson.type === t.value ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-line hover:bg-surface-2', t.soon && 'cursor-not-allowed opacity-50')}>
                  <t.icon className="size-4" aria-hidden /><span className="flex-1">{t.label}</span>{t.soon && <span className="text-[10px]">{t.soon}</span>}
                </button>
              ))}
            </div>
            {!showMoreTypes && (
              <button type="button" className="mt-2 text-sm font-medium text-primary-600 hover:underline" onClick={() => setShowMoreTypes(true)}>
                More types ({MORE_TYPES.filter((t) => !t.soon).length})
              </button>
            )}
          </div>
        </form>
      </Modal>
      <Modal open={Boolean(renaming)} onClose={() => setRenaming(null)} title={dripType !== 'NONE' ? 'Edit section' : 'Rename section'}
        footer={<><Button variant="secondary" onClick={() => setRenaming(null)}>Cancel</Button><Button disabled={!renaming?.title.trim()} onClick={renameSection}>Save</Button></>}>
        <div className="space-y-4">
          <Input label="Section title" value={renaming?.title ?? ''} onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} />
          {dripType === 'DAYS_AFTER_ENROLL' && (
            <Input
              label="Unlock after (days from enrolment)"
              type="number"
              min={0}
              hint="Leave empty to unlock with the course. Day 0 = immediately."
              value={renaming?.dripOffsetDays ?? ''}
              onChange={(e) => setRenaming({ ...renaming, dripOffsetDays: e.target.value })}
            />
          )}
          {dripType === 'DATE' && (
            <Input
              label="Unlock on date"
              type="date"
              hint="Leave empty to unlock with the course."
              value={renaming?.unlockAt ?? ''}
              onChange={(e) => setRenaming({ ...renaming, unlockAt: e.target.value })}
            />
          )}
        </div>
      </Modal>
      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} title={`Delete ${toDelete?.kind} “${toDelete?.item.title}”?`}
        description={toDelete?.kind === 'section' ? 'All lessons in this section are deleted too.' : 'Sub-lessons are deleted too. This cannot be undone.'} confirmLabel="Delete" onConfirm={confirmDelete} />
      {/* expose for tests */}
      <span hidden data-testid="section-count">{sections.length}</span>
    </div>
  );
}

