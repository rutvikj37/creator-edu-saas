import { Checkbox, Input, Select } from '../ui/index.js';

/** Inputs for an academy's custom fields; `values` is { fieldId: string }. */
export function CustomFieldInputs({ fields, values, onChange, errors = {} }) {
  const set = (id, v) => onChange({ ...values, [id]: v });
  return fields.map((f) => {
    const common = { key: f.id, label: f.label, required: f.required, error: errors[f.id] };
    const v = values[f.id] ?? '';
    if (f.type === 'SELECT') return <Select {...common} value={v} placeholder="Choose…" onChange={(e) => set(f.id, e.target.value)} options={f.options.map((o) => ({ value: o, label: o }))} />;
    if (f.type === 'CHECKBOX') return <div key={f.id}><Checkbox label={`${f.label}${f.required ? ' *' : ''}`} checked={v === 'true'} onChange={(e) => set(f.id, e.target.checked ? 'true' : 'false')} />{errors[f.id] && <p role="alert" className="mt-1 text-xs text-red-600">{errors[f.id]}</p>}</div>;
    return <Input {...common} type={f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : 'text'} value={v} maxLength={500} onChange={(e) => set(f.id, e.target.value)} />;
  });
}

/** Client-side check that mirrors the server: required answers present. Returns { fieldId: message }. */
export function missingCustomFields(fields, values) {
  return Object.fromEntries(fields.filter((f) => f.required && (!values[f.id] || (f.type === 'CHECKBOX' && values[f.id] !== 'true'))).map((f) => [f.id, `${f.label} is required`]));
}
