import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Vite config for both Storybook (dev/build) and addon-vitest (story tests).
// `@tailwindcss/vite` is the v4-beta way to compile @theme tokens; matches
// what apps/web's PostCSS plugin does at build time.
//
// No `resolve.alias` — `@lifecoach/ui` is a workspace dependency, so pnpm's
// node_modules symlink + the package's `exports` map (incl. ./styles.css)
// resolve correctly via Vite's default node-modules resolution.
export default defineConfig({
  plugins: [tailwindcss()],
});
