import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ToolCallBadge } from './tool-call-badge';

const meta: Meta<typeof ToolCallBadge> = {
  title: 'Molecules/ToolCallBadge',
  component: ToolCallBadge,
  args: { label: 'searching the web' },
};

export default meta;

type Story = StoryObj<typeof ToolCallBadge>;

export const Running: Story = {
  args: { done: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/searching the web/i)).toBeInTheDocument();
  },
};

export const DoneOk: Story = {
  args: { done: true, ok: true, label: 'searched the web' },
};

export const DoneError: Story = {
  args: { done: true, ok: false, label: 'web search failed' },
};
