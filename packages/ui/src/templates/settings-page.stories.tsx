import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { SettingsPageTemplate } from './settings-page';

const meta: Meta<typeof SettingsPageTemplate> = {
  title: 'Templates/SettingsPageTemplate',
  component: SettingsPageTemplate,
};

export default meta;

type Story = StoryObj<typeof SettingsPageTemplate>;

export const Default: Story = {
  args: {
    header: <h1 className="text-lg font-semibold">Your settings</h1>,
    tabs: (
      <nav className="flex gap-2 text-sm">
        <span className="font-medium">Connections</span>
        <span className="text-muted-foreground">Practices</span>
        <span className="text-muted-foreground">Profile</span>
      </nav>
    ),
    children: <p className="text-sm text-muted-foreground">Active tab content goes here.</p>,
    footer: <p className="text-xs text-muted-foreground">saving…</p>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/your settings/i)).toBeInTheDocument();
    await expect(canvas.getByText(/active tab content/i)).toBeInTheDocument();
  },
};
