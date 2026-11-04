import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '../ui/index.js';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';

/** Debounced search box that reports changes after the user pauses typing. */
export function SearchInput({ value = '', onChange, placeholder = 'Search…', className }) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <div className={className}>
      <Input aria-label={placeholder} placeholder={placeholder} leftIcon={Search} value={text} onChange={(e) => setText(e.target.value)} />
    </div>
  );
}
