// Tailwind v4 is CSS-first. The PostCSS plugin is the only build integration
// we need — no tailwind.config.js. Design tokens + @import live in
// @lifecoach/ui's globals.css, which layout.tsx imports.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
