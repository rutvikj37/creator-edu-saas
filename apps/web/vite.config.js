import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** The production nginx security headers, so `vite preview` exercises the same Content-Security-Policy. */
function productionHeaders(vars) {
  const text = readFileSync(new URL('../../infra/nginx/security-headers.inc.template', import.meta.url), 'utf8');
  const headers = {};
  for (const m of text.matchAll(/^add_header\s+(\S+)\s+(?:"((?:[^"\\]|\\.)*)"|(\S+))\s+always;$/gm)) {
    headers[m[1]] = (m[2] ?? m[3]).replace(/\\"/g, '"').replace(/\$\{(CSP_\w+)\}/g, (_, k) => vars[k] ?? '').replace(/\s+;/g, ';');
  }
  return headers;
}

export default defineConfig(({ mode }) => {
  // Only VITE_* variables are exposed to the browser bundle; secrets never belong here.
  const env = loadEnv(mode, '../../', 'VITE_');
  const root = env.VITE_PLATFORM_ROOT_DOMAIN || 'lvh.me';
  const extraHosts = [env.VITE_APP_HOST, env.VITE_ADMIN_HOST].filter(Boolean);
  const allowedHosts = [`.${root}`, 'localhost', ...extraHosts];
  // ws: true so Socket.IO upgrades on /api/socket.io pass through the same-origin proxy.
  const proxy = { '/api': { target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4000', changeOrigin: false, xfwd: true, ws: true } };
  return {
    envDir: '../../',
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      // Allow tenant subdomains (academy1.lvh.me) and platform / admin hosts in development.
      allowedHosts,
      // Same-origin API: the browser calls /api on the academy/platform host itself, so the
      // API resolves the tenant from the Host header and cookies stay scoped to that host.
      proxy,
    },
    preview: {
      host: true,
      allowedHosts,
      proxy,
      headers: productionHeaders(process.env),
    },
    build: { sourcemap: true, chunkSizeWarningLimit: 700 },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.js'],
      css: false,
    },
  };
});
