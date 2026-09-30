import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = `http://127.0.0.1:${env.PORT || 3001}`;
  return { plugins: [react()], server: { host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': backend, '/media': backend, '/_AMapService': backend } } };
});
