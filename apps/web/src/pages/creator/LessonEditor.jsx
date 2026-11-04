import { useEffect, useState } from 'react';
import { Button, Drawer, Input, Switch, toast } from '../../components/ui/index.js';
import { Alert } from '../../components/auth/Alert.jsx';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { RichTextEditor } from '../../components/forms/RichTextEditor.jsx';
import { coursesApi } from '../../services/api/creator.js';

const ACCEPT = {
  PDF: 'application/pdf',
  DOCUMENT: '.pdf,.docx,.pptx,.xlsx,.txt,.csv,application/pdf',
  IMAGE: 'image/png,image/jpeg,image/webp,image/gif',
  AUDIO: 'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav',
  DOWNLOAD: '.pdf,.zip,.docx,.pptx,.xlsx,.txt,.csv,image/*',
};

/** Side drawer for editing one lesson's content and settings. */
export function LessonEditor({ courseId, lesson, onClose, onSaved, readOnly }) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (lesson) {
      setDraft({ title: lesson.title, content: lesson.content ?? null, externalUrl: lesson.externalUrl ?? '', file: lesson.file ?? null, isFreePreview: lesson.isFreePreview, isPublished: lesson.isPublished, isRequired: lesson.isRequired, durationMinutes: lesson.durationSeconds ? Math.round(lesson.durationSeconds / 60) : '' });
      setErrors({});
    }
  }, [lesson]);
  if (!lesson || !draft) return <Drawer open={false} onClose={onClose} title="" />;

  const save = async () => {
    setSaving(true);
    setErrors({});
    const body = { title: draft.title, isFreePreview: draft.isFreePreview, isRequired: draft.isRequired, durationSeconds: draft.durationMinutes === '' ? null : Number(draft.durationMinutes) * 60 };
    if (lesson.type !== 'VIDEO') body.isPublished = draft.isPublished;
    if (lesson.type === 'TEXT') body.content = draft.content;
    if (lesson.type === 'LINK') body.externalUrl = draft.externalUrl || null;
    if (ACCEPT[lesson.type]) body.fileAssetId = draft.file?.id ?? null;
    try {
      await coursesApi.updateLesson(courseId, lesson.id, body);
      toast.success('Lesson saved');
      onSaved();
    } catch (e) {
      setErrors(Object.fromEntries((e.details ?? []).map((d) => [d.field, d.message])));
      if (!e.details?.length) toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open onClose={onClose} title={`Edit ${lesson.type.toLowerCase()} lesson`}
      footer={!readOnly && <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save lesson</Button></>}>
      <div className="space-y-5">
        <Input label="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} error={errors.title} disabled={readOnly} />
        {lesson.type === 'TEXT' && <RichTextEditor label="Content" value={draft.content} onChange={(content) => setDraft({ ...draft, content })} error={errors.content} />}
        {lesson.type === 'LINK' && <Input label="URL" type="url" placeholder="https://" value={draft.externalUrl} onChange={(e) => setDraft({ ...draft, externalUrl: e.target.value })} error={errors.externalUrl} />}
        {ACCEPT[lesson.type] && (
          <div>
            <FileUpload purpose="LESSON_FILE" accept={ACCEPT[lesson.type]} label="File" preview="file" hint="Max 500 MB" value={draft.file}
              onUploaded={(f) => setDraft({ ...draft, file: { id: f.id, fileName: f.fileName } })} onClear={() => setDraft({ ...draft, file: null })} />
            {errors.fileAssetId && <p className="mt-1 text-xs text-red-600">{errors.fileAssetId}</p>}
          </div>
        )}
        {lesson.type === 'VIDEO' && (
          <Alert tone="info" title="Video hosting">Upload and protected playback are enabled with the video module. This lesson stays in draft until a processed video is attached.</Alert>
        )}
        <Input label="Duration (minutes, optional)" type="number" min={0} value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: e.target.value })} />
        <div className="space-y-3 border-t border-line pt-4">
          <Switch label="Free preview (visible before purchase)" checked={draft.isFreePreview} onChange={(v) => setDraft({ ...draft, isFreePreview: v })} />
          <Switch label="Required for completion" checked={draft.isRequired} onChange={(v) => setDraft({ ...draft, isRequired: v })} />
          {lesson.type !== 'VIDEO' && <Switch label="Published" checked={draft.isPublished} onChange={(v) => setDraft({ ...draft, isPublished: v })} />}
        </div>
      </div>
    </Drawer>
  );
}
