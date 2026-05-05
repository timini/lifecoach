import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { UpgradePrompt } from './upgrade-prompt';

const meta: Meta<typeof UpgradePrompt> = {
  title: 'Molecules/UpgradePrompt',
  component: UpgradePrompt,
  args: { disabled: false, onInterest: fn() },
};

export default meta;

type Story = StoryObj<typeof UpgradePrompt>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /interested/i }));
    await expect(args.onInterest).toHaveBeenCalledOnce();
  },
};

export const Disabled: Story = { args: { disabled: true } };
