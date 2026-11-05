import { Trash2 } from 'lucide-react';
import { Button, Checkbox, Input, Select, Textarea } from '../ui/index.js';
import { RichTextEditor } from '../forms/RichTextEditor.jsx';
import { FileUpload } from '../forms/FileUpload.jsx';
import { BLOCK_DEFS } from './blocks.jsx';

/** One editable field of a block (types from BLOCK_DEFS). `error` comes from API validation. */
export function BlockField({ f, value, onChange, courses = [], files, error }) {
  if (f.type === 'textarea') return <Textarea label={f.label} rows={3} maxLength={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} error={error} />;
  if (f.type === 'select') return <Select label={f.label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={f.options.map(([v, l]) => ({ value: v, label: l }))} error={error} />;
  if (f.type === 'number') return <Input label={f.label} type="number" min={f.min} max={f.max} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} error={error} />;
  if (f.type === 'richtext') return <RichTextEditor label={f.label} value={value} onChange={onChange} minHeight={140} error={error} />;
  if (f.type === 'image') {
    return (
      <div>
        <FileUpload purpose="IMAGE" accept="image/png,image/jpeg,image/webp" label={f.label} value={value ? { id: value, url: files?.[value] } : null} onUploaded={(file) => onChange(file.id, file.url)} onClear={() => onChange(null)} />
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }
  if (f.type === 'courses') {
    const ids = value ?? [];
    return (
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{f.label}</legend>
        {courses.length === 0 ? <p className="text-sm text-muted">Publish a course to show it here.</p> : (
          <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-line p-3">
            {courses.map((c) => <Checkbox key={c.id} label={c.title} checked={ids.includes(c.id)} onChange={() => onChange(ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id])} />)}
          </div>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </fieldset>
    );
  }
  if (f.type === 'list') {
    const items = value ?? [];
    const set = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
    return (
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{f.label}</legend>
        {items.map((it, i) => (
          <div key={i} className="space-y-2 rounded-md border border-line p-3">
            {f.item.map((sub) => <BlockField key={sub.key} f={sub} value={it[sub.key]} onChange={(val) => set(i, { [sub.key]: val })} courses={courses} />)}
            <div className="text-right"><Button size="sm" variant="ghost" leftIcon={Trash2} onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</Button></div>
          </div>
        ))}
        {items.length < f.max && <Button size="sm" variant="secondary" onClick={() => onChange([...items, { ...f.blank }])}>Add</Button>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </fieldset>
    );
  }
  return <Input label={f.label} maxLength={f.max ?? 500} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.type === 'href' ? '/courses or https://…' : undefined} error={error} />;
}

/**
 * All fields of a block. `errors` maps a field key to a message. `onChange(props, newFiles?)`
 * receives the full new props (and a {fileId: url} map when an image was uploaded).
 */
export function BlockFields({ block, courses, files, errors = {}, onChange }) {
  const def = BLOCK_DEFS[block.type];
  if (!def) return null;
  return (
    <div className="space-y-3">
      {def.fields.filter((f) => !f.when || f.when(block.props)).map((f) => (
        <BlockField key={f.key} f={f} value={block.props[f.key]} courses={courses} files={files} error={errors[f.key]}
          onChange={(val, url) => onChange({ ...block.props, [f.key]: val }, url ? { [val]: url } : undefined)} />
      ))}
    </div>
  );
}
