import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client for browser tests: runs beside the normal dev client (5175) and talks to the
// E2E backend (tests/e2e/server.ts on 3105), which uses fake LiveSign / storage / email.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5185,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3105', changeOrigin: true },
      '/__test': { target: 'http://localhost:3105', changeOrigin: true }
    }
  }
});
