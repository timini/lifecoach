import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { WorkspacePrompt } from './workspace-prompt';

const meta: Meta<typeof WorkspacePrompt> = {
  title: 'Molecules/WorkspacePrompt',
  component: WorkspacePrompt,
  args: { disabled: false, onConnect: fn() },
};

export default meta;

type Story = StoryObj<typeof WorkspacePrompt>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /connect workspace/i }));
    await expect(args.onConnect).toHaveBeenCalledOnce();
  },
};

export const Disabled: Story = { args: { disabled: true } };
