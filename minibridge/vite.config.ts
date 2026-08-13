import { defineConfig } from 'vite';

// MiniBridge builds straight into the live document root. `public/minibridge/`
// is already served by the main texflow express app (server.js mounts
// express.static on public/), so a build is the whole deploy — no new process,
// no pm2 restart, no site-wide outage.
export default defineConfig({
  base: '/minibridge/',
  build: {
    outDir: '../public/minibridge',
    emptyOutDir: true,
    target: 'es2022',
    // web-llm is dynamically imported in lib/engine.ts, so rollup already gives
    // it its own chunk — listing it in manualChunks would drag it back into the
    // initial graph and undo that.
    rollupOptions: {
      output: {
        manualChunks: {
          'tasks-vision': ['@mediapipe/tasks-vision'],
        },
      },
    },
  },
  server: { host: true },
});
