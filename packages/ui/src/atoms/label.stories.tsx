import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { Input } from './input';
import { Label } from './label';

const meta: Meta<typeof Label> = {
  title: 'Atoms/Label',
  component: Label,
  args: { children: 'Email address' },
};

export default meta;

type Story = StoryObj<typeof Label>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Email address')).toBeInTheDocument();
  },
};

export const PairedWithInput: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <Label {...args} htmlFor="demo-email">
        Email address
      </Label>
      <Input id="demo-email" type="email" placeholder="you@example.com" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Clicking the label should focus the associated input via htmlFor.
    const label = canvas.getByText('Email address');
    label.click();
    const input = canvas.getByRole('textbox');
    await expect(input).toHaveFocus();
  },
};
