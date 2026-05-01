import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AuthPrompt } from './auth-prompt';

const meta: Meta<typeof AuthPrompt> = {
  title: 'Molecules/AuthPrompt',
  component: AuthPrompt,
  args: { disabled: false, onGoogle: fn(), onEmail: fn() },
};

export default meta;

type Story = StoryObj<typeof AuthPrompt>;

export const Google: Story = {
  args: { mode: 'google' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /sign in with google/i }));
    await expect(args.onGoogle).toHaveBeenCalledOnce();
  },
};

export const Email: Story = {
  args: { mode: 'email' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText(/you@example.com/i);
    await userEvent.type(input, 'tim@example.com');
    await userEvent.click(canvas.getByRole('button', { name: /send link/i }));
    await expect(args.onEmail).toHaveBeenCalledWith('tim@example.com');
  },
};

export const Disabled: Story = {
  args: { mode: 'google', disabled: true },
};
