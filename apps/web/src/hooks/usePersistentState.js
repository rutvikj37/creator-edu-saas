import { useEffect, useState } from 'react';
import { prefs } from '../utils/storage.js';

/** useState that remembers its value in localStorage (UI preferences only). */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => prefs.get(key, initial));
  useEffect(() => {
    prefs.set(key, value);
  }, [key, value]);
  return [value, setValue];
}
