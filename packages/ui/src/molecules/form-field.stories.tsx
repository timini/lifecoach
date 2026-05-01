import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';
import { FormField } from './form-field';

const meta: Meta<typeof FormField> = {
  title: 'Molecules/FormField',
  component: FormField,
  args: { label: 'Email', placeholder: 'you@example.com', type: 'email' },
};

export default meta;

type Story = StoryObj<typeof FormField>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText(/email/i);
    await userEvent.type(input, 'tim@example.com');
    await expect(input).toHaveValue('tim@example.com');
  },
};

export const WithDescription: Story = {
  args: {
    description: "We'll send a magic link, never spam.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText(/email/i);
    const descId = input.getAttribute('aria-describedby');
    await expect(descId).toBeTruthy();
    await expect(canvas.getByText(/magic link/i).id).toBe(descId);
  },
};

export const Invalid: Story = {
  args: {
    description: 'That email looks malformed.',
    invalid: true,
    defaultValue: 'not-an-email',
  },
};
