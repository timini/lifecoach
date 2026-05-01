import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { Bubble } from './bubble';

const meta: Meta<typeof Bubble> = {
  title: 'Molecules/Bubble',
  component: Bubble,
  args: { children: 'The day is bright. The work, gentle. Begin.' },
};

export default meta;

type Story = StoryObj<typeof Bubble>;

export const Assistant: Story = {
  args: { from: 'assistant' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const node = canvas.getByText(/begin/i);
    await expect(node.getAttribute('data-from')).toBe('assistant');
  },
};

export const User: Story = {
  args: { from: 'user', children: "Got it — I'll start with the easy one." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const node = canvas.getByText(/start with the easy one/i);
    await expect(node.getAttribute('data-from')).toBe('user');
  },
};

export const LongMessage: Story = {
  args: {
    from: 'assistant',
    children:
      'Sometimes the best move is to write down three things you noticed today. Not big things — small ones. The crow on the railing, the way light fell on a teacup, a kindness from a stranger.',
  },
};
