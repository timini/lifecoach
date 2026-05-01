import type { StorybookConfig } from '@storybook/nextjs-vite';

const config: StorybookConfig = {
  // Storybook lives in apps/ui-book but the stories live in packages/ui.
  // The glob is relative to this main.ts file (i.e. apps/ui-book/.storybook).
  stories: ['../../../packages/ui/src/**/*.stories.@(ts|tsx)'],

  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],

  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },

  typescript: {
    check: false,
    reactDocgen: 'react-docgen-typescript',
  },
};

export default config;
