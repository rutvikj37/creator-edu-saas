import { useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AudioLines, ChevronDown, ChevronRight, CornerDownRight, Download, File, FileText, GripVertical, Image, Link2, MoreHorizontal, Plus, Radio, ClipboardCheck, PenSquare, Trash2, Video } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Dropdown, DropdownItem, DropdownSeparator, Input, Modal, toast } from '../../components/ui/index.js';
import { coursesApi } from '../../services/api/creator.js';
import { cn } from '../../utils/cn.js';

export const LESSON_TYPES = [
  { value: 'TEXT', label: 'Text', icon: FileText },
  { value: 'VIDEO', label: 'Video', icon: Video },
  { value: 'PDF', label: 'PDF', icon: File },
  { value: 'DOCUMENT', label: 'Document', icon: File },
  { value: 'IMAGE', label: 'Image', icon: Image },
  { value: 'AUDIO', label: 'Audio', icon: AudioLines },
  { value: 'DOWNLOAD', label: 'Download', icon: Download },
  { value: 'LINK', label: 'External link', icon: Link2 },
  { value: 'QUIZ', label: 'Quiz', icon: ClipboardCheck, soon: 'Phase 5' },
  { value: 'ASSIGNMENT', label: 'Assignment', icon: PenSquare, soon: 'Phase 5' },
  { value: 'LIVE', label: 'Live class', icon: Radio, soon: 'Phase 9' },
];
const TYPE_BY = Object.fromEntries(LESSON_TYPES.map((t) => [t.value, t]));

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
export function CurriculumBuilder({ courseId, sections, onChange, onEditLesson, readOnly }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [collapsed, setCollapsed] = useState({});
  const [adding, setAdding] = useState(null); // { sectionId, parentLessonId? }
  const [newLesson, setNewLesson] = useState({ title: '', type: 'TEXT' });
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
      setNewLesson({ title: '', type: 'TEXT' });
      await reload();
      onEditLesson(l);
    } catch (e) { toast.error(e.details?.[0]?.message ?? e.message); } finally { setBusy(false); }
  };
  const renameSection = async () => {
    try { await coursesApi.updateSection(courseId, renaming.id, { title: renaming.title }); setRenaming(null); await reload(); } catch (e) { toast.error(e.message); }
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
      {!parent && <DropdownItem onClick={() => { setAdding({ sectionId: section.id, parentLessonId: lesson.id }); setNewLesson({ title: '', type: 'TEXT' }); }}>Add sub-lesson</DropdownItem>}
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
                    <span className="text-xs text-muted">{section.lessons.reduce((n, l) => n + 1 + (l.children?.length ?? 0), 0)} lessons</span>
                    {!readOnly && (
                      <Dropdown trigger={(p) => <Button variant="ghost" size="icon-sm" aria-label={`Actions for section ${section.title}`} {...p}><MoreHorizontal className="size-4" /></Button>}>
                        <DropdownItem onClick={() => setRenaming({ id: section.id, title: section.title })}>Rename</DropdownItem>
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
                      {section.lessons.length === 0 && <p className="px-2 py-3 text-sm text-muted">No lessons yet.</p>}
                      {!readOnly && <Button variant="ghost" size="sm" leftIcon={Plus} onClick={() => { setAdding({ sectionId: section.id }); setNewLesson({ title: '', type: 'TEXT' }); }}>Add lesson</Button>}
                    </div>
                  )}
                </>
              )}
            </Sortable>
          ))}
        </SortableContext>
      </DndContext>
      {!readOnly && (
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Lesson type">
              {LESSON_TYPES.map((t) => (
                <button key={t.value} type="button" role="radio" aria-checked={newLesson.type === t.value} disabled={Boolean(t.soon)}
                  onClick={() => setNewLesson({ ...newLesson, type: t.value })}
                  className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm', newLesson.type === t.value ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-line hover:bg-surface-2', t.soon && 'cursor-not-allowed opacity-50')}>
                  <t.icon className="size-4" aria-hidden /><span className="flex-1">{t.label}</span>{t.soon && <span className="text-[10px]">{t.soon}</span>}
                </button>
              ))}
            </div>
          </div>
        </form>
      </Modal>
      <Modal open={Boolean(renaming)} onClose={() => setRenaming(null)} title="Rename section"
        footer={<><Button variant="secondary" onClick={() => setRenaming(null)}>Cancel</Button><Button disabled={!renaming?.title.trim()} onClick={renameSection}>Save</Button></>}>
        <Input label="Section title" value={renaming?.title ?? ''} onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} />
      </Modal>
      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} title={`Delete ${toDelete?.kind} “${toDelete?.item.title}”?`}
        description={toDelete?.kind === 'section' ? 'All lessons in this section are deleted too.' : 'Sub-lessons are deleted too. This cannot be undone.'} confirmLabel="Delete" onConfirm={confirmDelete} />
      {/* expose for tests */}
      <span hidden data-testid="section-count">{sections.length}</span>
    </div>
  );
}

