import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { CapabilityTile } from './capability-tile';

const meta: Meta<typeof CapabilityTile> = {
  title: 'Molecules/CapabilityTile',
  component: CapabilityTile,
  args: { onConnect: fn() },
};

export default meta;

type Story = StoryObj<typeof CapabilityTile>;

export const Available: Story = {
  args: {
    id: 'workspace',
    title: 'Personal assistant',
    body: 'Triage your inbox, plan around your calendar, capture quick tasks straight to Google Tasks.',
    iconKey: 'workspace',
    status: 'available',
    cta: 'connect_workspace',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Personal assistant/i)).toBeVisible();
    const btn = canvas.getByRole('button', { name: /^connect$/i });
    await expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    await expect(args.onConnect).toHaveBeenCalledWith('connect_workspace');
  },
};

export const Connected: Story = {
  args: {
    id: 'notion',
    title: 'Task tracking',
    body: "Keep your TODOs in Notion as a tree of projects + sub-tasks. I'll keep the notes current as we work.",
    iconKey: 'notion',
    status: 'connected',
    cta: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole('button', { name: /connected/i });
    // Inert: clicking should NOT fire onConnect.
    await expect(btn).toBeDisabled();
    await userEvent.click(btn, { pointerEventsCheck: 0 });
    await expect(args.onConnect).not.toHaveBeenCalled();
  },
};

export const ComingSoon: Story = {
  args: {
    id: 'career_coaching',
    title: 'Career coaching',
    body: 'Walk-through exercises and reflective reports for the career questions on your mind. (Coming soon.)',
    iconKey: 'career',
    status: 'coming_soon',
    cta: null,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole('button', { name: /coming soon/i });
    await expect(btn).toBeDisabled();
    await userEvent.click(btn, { pointerEventsCheck: 0 });
    await expect(args.onConnect).not.toHaveBeenCalled();
  },
};
