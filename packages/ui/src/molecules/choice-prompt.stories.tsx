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
    single: true,
    question: 'Choose a **recovery** focus:',
    options: ['**Walk** for 10 minutes', 'Journal _one_ thing', '`Mute` notifications'],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Inline markdown is rendered (not shown raw) in the question + labels.
    await expect(canvas.getByText('recovery').tagName).toBe('STRONG');
    await expect(canvas.getByText('Walk').tagName).toBe('STRONG');
    await expect(canvas.getByText('one').tagName).toBe('EM');
    await expect(canvas.getByText('Mute').tagName).toBe('CODE');
    // The option value submitted is the raw string, not the rendered HTML.
    await userEvent.click(canvas.getByLabelText(/walk for 10 minutes/i));
    await userEvent.click(canvas.getByRole('button', { name: /select/i }));
    await expect(args.onSubmit).toHaveBeenCalledWith('**Walk** for 10 minutes');
  },
};

export const MarkdownDoesNotRenderLinks: Story = {
  args: {
    single: false,
    question: 'Which **focus support** should we try?',
    options: ['[Take a walk](https://example.com) after the first block', 'Mute notifications'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // A link in a choice label must render as plain text — never a clickable
    // anchor inside a radio/checkbox label.
    await expect(canvas.queryByRole('link')).toBeNull();
    await expect(canvas.getByText(/Take a walk/)).toBeTruthy();
  },
};

export const MultilineQuestionStacks: Story = {
  args: {
    single: true,
    // The triage archive digest arrives as newline-separated bullet lines.
    question:
      'Archive 3 calendar notifications?\n• Antler — Interview confirmed\n• Yonder yoga\n• Run Club 10k',
    options: ['Yes, archive all 3', 'Let me pick', 'Skip'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Each bullet must land on its own line (a <br>), not run together.
    const root = canvas.getByTestId('choice-prompt');
    await expect(root.querySelectorAll('br').length).toBeGreaterThanOrEqual(3);
    await expect(canvas.getByText(/Run Club 10k/)).toBeTruthy();
  },
};

export const Disabled: Story = {
  args: { single: true, disabled: true },
};
