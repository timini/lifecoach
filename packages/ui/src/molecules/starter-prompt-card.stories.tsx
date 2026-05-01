import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { StarterPromptCard } from './starter-prompt-card';

const meta: Meta<typeof StarterPromptCard> = {
  title: 'Molecules/StarterPromptCard',
  component: StarterPromptCard,
  args: {
    prompt: 'Help me plan a calmer morning routine',
    onSelect: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof StarterPromptCard>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /calmer morning routine/i }));
    await expect(args.onSelect).toHaveBeenCalledWith('Help me plan a calmer morning routine');
  },
};

export const Row: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <StarterPromptCard {...args} prompt="Reflect on yesterday" />
      <StarterPromptCard {...args} prompt="Help me plan a calmer morning routine" />
      <StarterPromptCard {...args} prompt="What's one tiny thing I can do right now?" />
    </div>
  ),
};
