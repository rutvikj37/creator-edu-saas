import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Only VITE_* variables are exposed to the browser bundle; secrets never belong here.
  const env = loadEnv(mode, '../../', 'VITE_');
  const root = env.VITE_PLATFORM_ROOT_DOMAIN || 'lvh.me';
  return {
    envDir: '../../',
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      // Allow tenant subdomains (academy1.lvh.me) and the platform host in development.
      allowedHosts: [`.${root}`, 'localhost'],
      // Same-origin API: the browser calls /api on the academy/platform host itself, so the
      // API resolves the tenant from the Host header and cookies stay scoped to that host.
      proxy: {
        '/api': { target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4000', changeOrigin: false, xfwd: true },
      },
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
