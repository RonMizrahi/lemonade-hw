import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_PORT = 5173;
const DEFAULT_API_TARGET = 'http://localhost:3000';

/**
 * Vite config: React SPA on port 5173, proxying `/onboarding` to the Nest API in dev.
 * The API target is read from `VITE_API_URL` (defaults to localhost:3000).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiTarget = env.VITE_API_URL || DEFAULT_API_TARGET;

  return {
    plugins: [react()],
    server: {
      port: DEV_PORT,
      proxy: {
        '/onboarding': { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
