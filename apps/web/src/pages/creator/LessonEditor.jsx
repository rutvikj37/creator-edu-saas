import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { Button, Drawer, Input, Select, Switch, toast } from '../../components/ui/index.js';
import { FileUpload } from '../../components/forms/FileUpload.jsx';
import { RichTextEditor } from '../../components/forms/RichTextEditor.jsx';
import { coursesApi } from '../../services/api/creator.js';
import { QuizEditor } from './QuizEditor.jsx';
import { AiDraftButton } from '../../components/ai/AiTools.jsx';
import { AssignmentEditor } from './AssignmentEditor.jsx';
import { readVideoDuration, uploadVideo, videosApi } from '../../services/api/videos.js';
import { startTusUpload } from '../../services/api/tusUpload.js';
import { VideoSourcePanel } from '../../components/video/VideoSourcePanel.jsx';
import { fmtDuration } from './VideosPage.jsx';

const ACCEPT = {
  PDF: 'application/pdf',
  DOCUMENT: '.pdf,.docx,.pptx,.xlsx,.txt,.csv,application/pdf',
  IMAGE: 'image/png,image/jpeg,image/webp,image/gif',
  AUDIO: 'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav',
  DOWNLOAD: '.pdf,.zip,.docx,.pptx,.xlsx,.txt,.csv,image/*',
};

/** Uploads a video from the lesson drawer and attaches it when ready. */
const IN_FLIGHT = ['UPLOADED', 'PROCESSING'];

function InlineVideoUpload({ courseId, lessonId, disabled, onAttached, pending }) {
  const inputRef = useRef(null);
  const [phase, setPhase] = useState(null); // uploading | processing | null
  const [progress, setProgress] = useState(0);
  const alive = useRef(true);
  const watching = useRef(null);
  const config = useQuery({ queryKey: ['videos', 'config'], queryFn: videosApi.config, staleTime: 60_000, retry: false });

  useEffect(() => () => { alive.current = false; }, []);

  // Closing the tab stops a browser upload; processing afterwards runs on the server and is safe.
  useEffect(() => {
    if (phase !== 'uploading') return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  const attach = async (videoId) => {
    await videosApi.edit(videoId, { courseId, lessonId });
    onAttached(videoId);
    toast.success('Video attached to this lesson');
  };

  /** Polls until READY while this editor is open; the server attaches it anyway if the page closes. */
  const waitReady = async (videoId) => {
    if (watching.current === videoId) return;
    watching.current = videoId;
    setPhase('processing');
    try {
      while (alive.current) {
        const s = await videosApi.status(videoId).catch(() => null);
        if (!alive.current) return;
        if (s?.status === 'READY') { await attach(videoId); setPhase(null); return; }
        if (s?.status === 'FAILED') throw new Error(s.errorMessage || 'Video processing failed');
        await new Promise((r) => setTimeout(r, 4000));
      }
    } finally {
      watching.current = null;
    }
  };

  // Reopened while a video for this lesson is still processing: pick it back up.
  useEffect(() => {
    if (pending?.id && !phase) waitReady(pending.id).catch((e) => { toast.error(e.message); if (alive.current) setPhase(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id]);

  const onFile = async (file) => {
    if (!file || disabled) return;
    setPhase('uploading');
    setProgress(0);
    try {
      if (config.data?.provider === 'BUNNY') {
        const init = await videosApi.initiate({
          title: file.name.replace(/\.[^.]+$/, '').slice(0, 200),
          filename: file.name,
          size: file.size,
          mimeType: file.type || 'video/mp4',
          courseId,
          lessonId,
        });
        const h = startTusUpload(file, init.upload, {
          onProgress: setProgress,
          onStart: () => videosApi.complete({ videoId: init.videoId, uploadSessionId: init.uploadSessionId, outcome: 'started' }).catch(() => {}),
        });
        await h.promise;
        await videosApi.complete({ videoId: init.videoId, uploadSessionId: init.uploadSessionId, outcome: 'success' });
        await waitReady(init.videoId);
        return;
      }
      const duration = await readVideoDuration(file);
      const f = await uploadVideo(file, setProgress);
      const created = await videosApi.create({
        fileId: f.id,
        title: file.name.replace(/\.[^.]+$/, '').slice(0, 200),
        durationSeconds: duration ?? undefined,
      });
      await attach(created.id);
      setPhase(null);
    } catch (e) {
      toast.error(e.details?.[0]?.message ?? e.message);
      setPhase(null);
    }
  };

  return (
    <VideoSourcePanel
      courseId={courseId}
      lessonId={lessonId}
      disabled={disabled || Boolean(phase)}
      compact
      onAttached={(v) => onAttached(v.id)}
    >
      <div className="space-y-2 rounded-lg border border-dashed border-line-strong bg-surface-2/40 p-3">
        <p className="text-sm font-medium text-fg">Upload from this computer</p>
        <p className="text-xs text-muted">
          {phase === 'uploading'
            ? 'Keep this page open until the upload finishes.'
            : phase === 'processing'
              ? 'Processing usually takes 1–3 minutes. You can close this page: the video attaches to this lesson automatically when it’s ready.'
              : 'Stays on this lesson — no need to leave for the asset library.'}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mp4,.mov,.webm,.mkv"
          className="hidden"
          disabled={disabled || Boolean(phase)}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={Upload}
          loading={Boolean(phase)}
          disabled={disabled || config.isLoading}
          onClick={() => inputRef.current?.click()}
        >
          {phase === 'uploading' ? `Uploading ${progress}%` : phase === 'processing' ? 'Processing…' : 'Choose video file'}
        </Button>
      </div>
    </VideoSourcePanel>
  );
}

/** Side drawer for editing one lesson's content and settings. */
export function LessonEditor({ courseId, lesson, onClose, onSaved, readOnly }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(null);
  const videos = useQuery({ queryKey: ['videos'], queryFn: videosApi.list, enabled: lesson?.type === 'VIDEO' });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (lesson) {
      setDraft({
        title: lesson.title,
        content: lesson.content ?? null,
        externalUrl: lesson.externalUrl ?? '',
        file: lesson.file ?? null,
        isFreePreview: lesson.isFreePreview,
        isPublished: lesson.isPublished ?? true,
        isRequired: lesson.isRequired,
        durationMinutes: lesson.durationSeconds ? Math.round(lesson.durationSeconds / 60) : '',
        videoAssetId: lesson.videoAssetId ?? '',
      });
      setErrors({});
    }
  }, [lesson]);
  if (!lesson || !draft) return <Drawer open={false} onClose={onClose} title="" />;

  const save = async () => {
    setSaving(true);
    setErrors({});
    const body = { title: draft.title, isFreePreview: draft.isFreePreview, isRequired: draft.isRequired, durationSeconds: draft.durationMinutes === '' ? null : Number(draft.durationMinutes) * 60 };
    if (lesson.type !== 'VIDEO') body.isPublished = draft.isPublished;
    if (lesson.type === 'VIDEO') { body.videoAssetId = draft.videoAssetId || null; body.isPublished = Boolean(draft.videoAssetId) && draft.isPublished; if (draft.durationMinutes === '') delete body.durationSeconds; }
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
        {lesson.type === 'TEXT' && (
          <div className="space-y-2">
            {!readOnly && <div className="flex justify-end"><AiDraftButton courseId={courseId} lessonId={lesson.id} hasContent={Boolean(draft.content?.content?.some((n) => n.content?.length))} onDraft={(content) => setDraft((d) => ({ ...d, content }))} /></div>}
            <RichTextEditor label="Content" value={draft.content} onChange={(content) => setDraft({ ...draft, content })} error={errors.content} />
          </div>
        )}
        {lesson.type === 'LINK' && <Input label="URL" type="url" placeholder="https://" value={draft.externalUrl} onChange={(e) => setDraft({ ...draft, externalUrl: e.target.value })} error={errors.externalUrl} />}
        {ACCEPT[lesson.type] && (
          <div>
            <FileUpload purpose="LESSON_FILE" accept={ACCEPT[lesson.type]} label="File" preview="file" hint="Max 500 MB" value={draft.file}
              onUploaded={(f) => setDraft({ ...draft, file: { id: f.id, fileName: f.fileName } })} onClear={() => setDraft({ ...draft, file: null })} />
            {errors.fileAssetId && <p className="mt-1 text-xs text-red-600">{errors.fileAssetId}</p>}
          </div>
        )}
        {lesson.type === 'QUIZ' && <QuizEditor courseId={courseId} lessonId={lesson.id} />}
        {lesson.type === 'ASSIGNMENT' && <AssignmentEditor courseId={courseId} lessonId={lesson.id} />}
        {lesson.type === 'VIDEO' && (
          <div className="space-y-4">
            {!readOnly && (
              <InlineVideoUpload
                courseId={courseId}
                lessonId={lesson.id}
                disabled={readOnly}
                pending={draft.videoAssetId ? null : (videos.data ?? []).find((v) => v.lessonId === lesson.id && IN_FLIGHT.includes(v.status))}
                onAttached={(videoId) => {
                  setDraft((d) => ({ ...d, videoAssetId: videoId, isPublished: true }));
                  qc.invalidateQueries({ queryKey: ['videos'] });
                }}
              />
            )}
            <Select
              label="Or pick from library"
              placeholder="Choose a ready video"
              value={draft.videoAssetId}
              error={errors.videoAssetId}
              onChange={(e) => setDraft({ ...draft, videoAssetId: e.target.value, isPublished: e.target.value ? true : false })}
              options={(videos.data ?? []).filter((v) => v.status === 'READY').map((v) => ({ value: v.id, label: `${v.title} (${fmtDuration(v.durationSeconds)})` }))}
            />
            {!readOnly && (
              <p className="text-xs text-muted">
                Prefer the full uploader?{' '}
                <Link
                  to={`/creator/videos?courseId=${encodeURIComponent(courseId)}&lessonId=${encodeURIComponent(lesson.id)}`}
                  className="font-medium text-primary-600 underline"
                >
                  Open asset library
                </Link>
              </p>
            )}
          </div>
        )}
        <details className="rounded-lg border border-line">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium marker:hidden">More options</summary>
          <div className="space-y-3 border-t border-line px-3 py-3">
            <Input label="Duration (minutes, optional)" type="number" min={0} value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: e.target.value })} />
            <Switch label="Free preview (visible before purchase)" checked={draft.isFreePreview} onChange={(v) => setDraft({ ...draft, isFreePreview: v })} />
            <Switch label="Required for completion" checked={draft.isRequired} onChange={(v) => setDraft({ ...draft, isRequired: v })} />
          </div>
        </details>
        {(lesson.type !== 'VIDEO' || draft.videoAssetId) && (
          <div className="space-y-1">
            <Switch label="Ready for students" checked={draft.isPublished} onChange={(v) => setDraft({ ...draft, isPublished: v })} />
            <p className="text-xs text-muted">Turn this on so the lesson counts when you publish the course.</p>
          </div>
        )}
      </div>
    </Drawer>
  );
}
