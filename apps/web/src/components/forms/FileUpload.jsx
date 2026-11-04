import { useRef, useState } from 'react';
import { FileText, ImageUp, Loader2, X } from 'lucide-react';
import { Button } from '../ui/index.js';
import { uploadFile } from '../../services/api/creator.js';
import { cn } from '../../utils/cn.js';

/**
 * Drag-and-drop single-file upload with progress. Calls onUploaded(fileView) once the
 * server has verified the file. `accept` mirrors the server's allow-list for the purpose.
 */
export function FileUpload({ purpose, accept, label, hint, value, onUploaded, onClear, preview = 'image', className }) {
  const input = useRef(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);

  const handle = async (file) => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const view = await uploadFile(file, purpose, setProgress);
      onUploaded?.(view);
    } catch (e) {
      setError(e.details?.[0]?.message ?? e.message);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <p className="text-sm font-medium text-fg-2">{label}</p>}
      {value?.url && preview === 'image' ? (
        <div className="flex items-center gap-3">
          <img src={value.url} alt="" className="size-16 rounded-lg border border-line object-contain" />
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>Replace</Button>
          {onClear && <Button variant="ghost" size="sm" leftIcon={X} onClick={onClear}>Remove</Button>}
        </div>
      ) : value?.fileName ? (
        <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-sm">
          <FileText className="size-4 text-muted" aria-hidden />
          <span className="flex-1 truncate">{value.fileName}</span>
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>Replace</Button>
          {onClear && <Button variant="ghost" size="icon-sm" aria-label="Remove file" onClick={onClear}><X className="size-4" /></Button>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files?.[0]); }}
          className={cn('flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-sm transition-colors', drag ? 'border-primary-500 bg-primary-50' : 'border-line hover:border-line-strong')}
        >
          {progress !== null ? <Loader2 className="size-5 animate-spin text-primary-600" /> : <ImageUp className="size-5 text-muted" aria-hidden />}
          <span className="font-medium">{progress !== null ? `Uploading… ${progress}%` : 'Drop a file or click to upload'}</span>
          {hint && <span className="text-xs text-muted">{hint}</span>}
        </button>
      )}
      {progress !== null && value?.url && <p className="text-xs text-muted">Uploading… {progress}%</p>}
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
      <input ref={input} type="file" accept={accept} className="sr-only" onChange={(e) => handle(e.target.files?.[0])} tabIndex={-1} aria-hidden />
    </div>
  );
}
