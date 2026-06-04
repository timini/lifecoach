import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ChoicePrompt } from './choice-prompt';

const meta: Meta<typeof ChoicePrompt> = {
  title: 'Molecules/ChoicePrompt',
  component: ChoicePrompt,
  args: {
    question: 'How are you feeling right now?',
    options: ['Calm', 'Anxious', 'Tired', 'Energised'],
    disabled: false,
    onSubmit: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof ChoicePrompt>;

export const Single: Story = {
  args: { single: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const calm = canvas.getByLabelText(/calm/i);
    await userEvent.click(calm);
    await userEvent.click(canvas.getByRole('button', { name: /select/i }));
    await expect(args.onSubmit).toHaveBeenCalledWith('Calm');
  },
};

export const Multi: Story = {
  args: { single: false },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText(/anxious/i));
    await userEvent.click(canvas.getByLabelText(/tired/i));
    await userEvent.click(canvas.getByRole('button', { name: /submit/i }));
    await expect(args.onSubmit).toHaveBeenCalledWith('Anxious, Tired');
  },
};

export const MarkdownLabels: Story = {
  args: {
    question: 'Choose a **recovery** focus:',
    options: ['**Walk** for 10 minutes', 'Journal _one_ thing', '`Mute` notifications'],
    single: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('recovery').tagName).toBe('STRONG');
    await expect(canvas.getByText('Walk').tagName).toBe('STRONG');
    await expect(canvas.getByText('one').tagName).toBe('EM');
    await expect(canvas.getByText('Mute').tagName).toBe('CODE');
  },
};

export const Disabled: Story = {
  args: { single: true, disabled: true },
};
