import { defineConfig } from 'vite';

// MiniBridge builds straight into the live document root. `public/minibridge/`
// is already served by the main texflow express app (server.js mounts
// express.static on public/), so a build is the whole deploy — no new process,
// no pm2 restart, no site-wide outage.
//
// One page, one entry. web-llm is dynamically imported in lib/engine.ts, so
// rollup already gives it its own chunk and the shell never pays for it —
// that split is the difference between the app opening instantly and the app
// parsing 6MB of JavaScript before it draws anything.
export default defineConfig({
  base: '/minibridge/',
  build: {
    outDir: '../public/minibridge',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: { host: true },
});
