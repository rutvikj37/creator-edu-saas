// Apply the saved theme before first paint to avoid a flash of the wrong theme.
// Kept as an external file so the Content-Security-Policy needs no 'unsafe-inline' for scripts.
try {
  var t = localStorage.getItem('ce.theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
