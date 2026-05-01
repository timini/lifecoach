import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Checkbox } from './checkbox';

const meta: Meta<typeof Checkbox> = {
  title: 'Atoms/Checkbox',
  component: Checkbox,
  args: {
    'aria-label': 'demo checkbox',
    onCheckedChange: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const cb = canvas.getByRole('checkbox', { name: /demo checkbox/i });
    await expect(cb).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(cb);
    await expect(cb).toHaveAttribute('aria-checked', 'true');
    await expect(args.onCheckedChange).toHaveBeenCalledWith(true);
  },
};

export const Checked: Story = {
  args: { checked: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  },
};

export const Disabled: Story = { args: { disabled: true } };
