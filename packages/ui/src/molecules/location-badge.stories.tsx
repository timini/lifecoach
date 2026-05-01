import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { LocationBadge } from './location-badge';

const meta: Meta<typeof LocationBadge> = {
  title: 'Molecules/LocationBadge',
  component: LocationBadge,
  args: { onShare: fn() },
};

export default meta;

type Story = StoryObj<typeof LocationBadge>;

export const NotShared: Story = {
  args: { shared: false, requested: false },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: /share location/i });
    await userEvent.click(button);
    await expect(args.onShare).toHaveBeenCalledOnce();
  },
};

export const Requested: Story = {
  args: { shared: false, requested: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: /no location/i });
    await expect(button).toBeDisabled();
  },
};

export const Shared: Story = {
  args: { shared: true, requested: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const node = canvas.getByText(/location shared/i);
    await expect(node.tagName).toBe('SPAN');
  },
};
