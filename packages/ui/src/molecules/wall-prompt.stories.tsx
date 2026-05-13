import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { WallPrompt } from './wall-prompt';

const meta: Meta<typeof WallPrompt> = {
  title: 'Molecules/WallPrompt',
  component: WallPrompt,
  args: { onAuthUser: fn(), onUpgradeToPro: fn(), disabled: false },
};

export default meta;

type Story = StoryObj<typeof WallPrompt>;

export const FreeAnonymous: Story = {
  args: { reason: 'free_limit', cta: 'auth_user' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Body copy names the chat-limit constraint and points at sign-in.
    await expect(canvas.getByText(/free chat limit/i)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: /sign in with google/i }));
    await expect(args.onAuthUser).toHaveBeenCalledOnce();
    // The signed-in / upgrade handler must NOT fire for the anon wall.
    await expect(args.onUpgradeToPro).not.toHaveBeenCalled();
  },
};

export const FreeSignedIn: Story = {
  args: { reason: 'free_signed_in_limit', cta: 'upgrade_to_pro' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/free chat limit/i)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: /interested in pro/i }));
    await expect(args.onUpgradeToPro).toHaveBeenCalledOnce();
    await expect(args.onAuthUser).not.toHaveBeenCalled();
  },
};

export const Disabled: Story = {
  args: { reason: 'free_limit', cta: 'auth_user', disabled: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Disabled button stays visible but inert — clicks don't fire.
    const btn = canvas.getByRole('button', { name: /sign in with google/i });
    await expect(btn).toBeDisabled();
    await userEvent.click(btn, { pointerEventsCheck: 0 });
    await expect(args.onAuthUser).not.toHaveBeenCalled();
  },
};
