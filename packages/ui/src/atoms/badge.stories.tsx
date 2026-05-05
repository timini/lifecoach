import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { Badge } from './badge';

const meta: Meta<typeof Badge> = {
  title: 'Atoms/Badge',
  component: Badge,
  args: { children: 'Connected' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['neutral', 'accent', 'success', 'warn', 'outline'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
};

export default meta;

type Story = StoryObj<typeof Badge>;

export const Neutral: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Connected')).toBeInTheDocument();
  },
};

export const Accent: Story = { args: { tone: 'accent', children: 'Beta' } };
export const Success: Story = { args: { tone: 'success', children: 'Connected' } };
export const Warn: Story = { args: { tone: 'warn', children: 'Pending' } };
export const Outline: Story = { args: { tone: 'outline', children: 'Coming soon' } };

export const AllTones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="neutral">Neutral</Badge>
      <Badge tone="accent">Accent</Badge>
      <Badge tone="success">Success</Badge>
      <Badge tone="warn">Warn</Badge>
      <Badge tone="outline">Outline</Badge>
    </div>
  ),
};
