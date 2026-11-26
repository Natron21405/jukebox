import { defineConfig } from 'vite';

// Served from https://<user>.github.io/jukebox/ on GitHub Pages.
// Relative asset paths are not used; the base must match the repo name.
export default defineConfig({
  base: '/jukebox/',
  envPrefix: 'VITE_', // only VITE_* variables reach the browser
  build: { target: 'es2020' },
  test: { include: ['src/**/*.test.ts'] },
});
