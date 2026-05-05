import type { Preview } from '@storybook/nextjs-vite';
// Imports the Tailwind v4 @theme tokens and the body mesh-gradient — same
// stylesheet apps/web loads, so stories render in the production palette.
import '@lifecoach/ui/styles.css';

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color|foreground|accent|destructive|border)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // Accessibility checks fail the addon-vitest run rather than just warn.
      test: 'error',
    },
  },
};

export default preview;
