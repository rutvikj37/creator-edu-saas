import { useEffect, useState } from 'react';
import { Film, HardDrive, Link2 } from 'lucide-react';
import { Button, Input, Tabs, toast } from '../ui/index.js';
import { parseVideoLink, videosApi } from '../../services/api/videos.js';

const SOURCE_TABS = [
  { value: 'upload', label: 'Upload' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'drive', label: 'Google Drive' },
];

/**
 * Shared Upload / YouTube / Drive chooser used by the lesson editor and asset library.
 * `onAttached(video)` fires after a link import succeeds. Children render the PC upload UI
 * when the Upload tab is selected.
 */
export function VideoSourcePanel({
  courseId,
  lessonId,
  disabled,
  onAttached,
  children,
  compact = false,
  defaultSource = 'upload',
}) {
  const [source, setSource] = useState(defaultSource);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const parsed = parseVideoLink(url);
    if (!url.trim()) { setPreview(null); setError(null); return; }
    if (!parsed) {
      setPreview(null);
      setError(source === 'youtube' ? 'Paste a YouTube watch, share or Shorts link' : 'Paste a Google Drive file link (Share → Anyone with the link)');
      return;
    }
    if (source === 'youtube' && parsed.provider !== 'YOUTUBE') {
      setPreview(null);
      setError('That looks like a Drive link — switch to the Google Drive tab');
      return;
    }
    if (source === 'drive' && parsed.provider !== 'GOOGLE_DRIVE') {
      setPreview(null);
      setError('That looks like a YouTube link — switch to the YouTube tab');
      return;
    }
    setError(null);
    setPreview(parsed);
  }, [url, source]);

  const importLink = async () => {
    if (disabled || !preview || error) return;
    setSaving(true);
    try {
      const v = await videosApi.fromLink({
        url: url.trim(),
        title: title.trim() || undefined,
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
      });
      toast.success(preview.provider === 'YOUTUBE' ? 'YouTube video added' : 'Google Drive video added');
      setUrl('');
      setTitle('');
      setPreview(null);
      onAttached?.(v);
    } catch (e) {
      toast.error(e.details?.[0]?.message ?? e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <Tabs tabs={SOURCE_TABS} value={source} onChange={(v) => { setSource(v); setUrl(''); setTitle(''); setPreview(null); setError(null); }} />
      {source === 'upload' && children}
      {source !== 'upload' && (
        <div className="space-y-3 rounded-lg border border-dashed border-line-strong bg-surface-2/40 p-3">
          <div className="flex items-start gap-2">
            {source === 'youtube' ? <Film className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : <HardDrive className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium text-fg">{source === 'youtube' ? 'Add from YouTube' : 'Add from Google Drive'}</p>
              <p className="text-xs text-muted">
                {source === 'youtube'
                  ? 'Paste a public YouTube link. We fetch the title and thumbnail automatically.'
                  : 'Paste a Drive file link shared as “Anyone with the link”. Thumbnails only appear when Drive allows public access; private files play only for viewers who already have access.'}
              </p>
            </div>
          </div>
          <Input
            label={source === 'youtube' ? 'YouTube URL' : 'Google Drive URL'}
            type="url"
            placeholder={source === 'youtube' ? 'https://www.youtube.com/watch?v=…' : 'https://drive.google.com/file/d/…/view'}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            error={error || undefined}
            disabled={disabled || saving}
            leftIcon={Link2}
          />
          <Input
            label="Title (optional)"
            placeholder={source === 'youtube' ? 'Uses the YouTube title when blank' : 'Name shown in your library'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={disabled || saving}
            maxLength={200}
          />
          {preview?.thumbnailUrl && (
            <div className="overflow-hidden rounded-md border border-line bg-surface">
              <img
                src={preview.thumbnailUrl}
                alt=""
                className="aspect-video w-full max-w-sm object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </div>
          )}
          <Button type="button" size="sm" leftIcon={Link2} loading={saving} disabled={disabled || !preview || Boolean(error)} onClick={importLink}>
            {source === 'youtube' ? 'Add YouTube video' : 'Add Drive video'}
          </Button>
        </div>
      )}
    </div>
  );
}
