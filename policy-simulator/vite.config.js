import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import generatePolicy from './api/generate-policy.js';

function localApiPlugin() {
  return {
    name: 'local-policy-api',
    configureServer(server) {
      server.middlewares.use('/api/generate-policy', async (req, res) => {
        if (req.method !== 'POST') return generatePolicy(req, res);
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          req.body = body ? JSON.parse(body) : {};
        } catch {
          req.body = null;
        }
        return generatePolicy(req, res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [react(), localApiPlugin()],
    test: {
      environment: 'jsdom',
      setupFiles: './src/testSetup.js',
      css: true,
    },
  };
});
