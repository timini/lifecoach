import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { Markdown } from './markdown';

const meta: Meta<typeof Markdown> = {
  title: 'Organisms/Markdown',
  component: Markdown,
};

export default meta;

type Story = StoryObj<typeof Markdown>;

export const Paragraph: Story = {
  args: { children: 'A small **bold** word and an _italic_ word.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('bold').tagName).toBe('STRONG');
    await expect(canvas.getByText('italic').tagName).toBe('EM');
  },
};

export const ListsAndLinks: Story = {
  args: {
    children: [
      'Try this:',
      '',
      '- one slow breath',
      '- one [kind link](https://example.com)',
      '- one note in your journal',
    ].join('\n'),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole('link', { name: /kind link/i });
    await expect(link.getAttribute('href')).toBe('https://example.com');
    await expect(link.getAttribute('target')).toBe('_blank');
  },
};
