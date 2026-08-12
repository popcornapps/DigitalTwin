import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Makes the browser see frontend+backend as one origin in dev, matching
    // the same-origin prod topology (see VITE_API_BASE_URL below) - the
    // session cookie set by the backend OAuth callback (app/routers/auth.py)
    // needs same-origin requests to attach reliably.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
