import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ChatComposer } from './chat-composer';

const meta: Meta<typeof ChatComposer> = {
  title: 'Organisms/ChatComposer',
  component: ChatComposer,
  args: { onSubmit: fn() },
};

export default meta;

type Story = StoryObj<typeof ChatComposer>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const send = canvas.getByRole('button', { name: /send/i }) as HTMLButtonElement;
    await expect(send.disabled).toBe(true);
  },
};

export const TypeAndSubmit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText(/message/i);
    await userEvent.type(input, 'hello there');
    const send = canvas.getByRole('button', { name: /send/i });
    await userEvent.click(send);
    await expect(args.onSubmit).toHaveBeenCalledWith('hello there');
    // Input clears after submit (uncontrolled).
    await expect(input).toHaveValue('');
  },
};

export const SubmitOnEnter: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText(/message/i);
    await userEvent.type(input, 'enter works{enter}');
    await expect(args.onSubmit).toHaveBeenCalledWith('enter works');
  },
};

export const WhitespaceDropped: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText(/message/i);
    await userEvent.type(input, '   ');
    const send = canvas.getByRole('button', { name: /send/i }) as HTMLButtonElement;
    await expect(send.disabled).toBe(true);
    // Submitting via Enter is also a no-op for whitespace-only input.
    await userEvent.type(input, '{enter}');
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText(/message/i) as HTMLInputElement;
    await expect(input.disabled).toBe(true);
  },
};
