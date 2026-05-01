import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Menu, Send, Settings } from 'lucide-react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { IconButton } from './icon-button';

const meta: Meta<typeof IconButton> = {
  title: 'Atoms/IconButton',
  component: IconButton,
  args: {
    'aria-label': 'Open menu',
    onClick: fn(),
    children: <Menu />,
  },
  argTypes: {
    variant: { control: 'inline-radio', options: ['ghost', 'solid', 'outline'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
  },
};

export default meta;

type Story = StoryObj<typeof IconButton>;

export const Ghost: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole('button', { name: /open menu/i });
    await userEvent.click(btn);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Solid: Story = {
  args: { variant: 'solid', 'aria-label': 'Send', children: <Send /> },
};

export const Outline: Story = {
  args: { variant: 'outline', 'aria-label': 'Settings', children: <Settings /> },
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <IconButton {...args} size="sm" aria-label="small">
        <Menu />
      </IconButton>
      <IconButton {...args} size="md" aria-label="medium">
        <Menu />
      </IconButton>
      <IconButton {...args} size="lg" aria-label="large">
        <Menu />
      </IconButton>
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole('button');
    await expect(btn).toBeDisabled();
    await userEvent.click(btn).catch(() => {});
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
