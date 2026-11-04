/** Safe localStorage wrapper for UI preferences (never for auth tokens). */
export const prefs = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`ce.${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`ce.${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable (private mode) — preference simply isn't remembered */
    }
  },
};
