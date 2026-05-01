import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { RadioGroup, RadioGroupItem } from './radio-group';

const meta: Meta<typeof RadioGroup> = {
  title: 'Atoms/RadioGroup',
  component: RadioGroup,
};

export default meta;

type Story = StoryObj<typeof RadioGroup>;

export const Default: Story = {
  args: { onValueChange: fn() },
  render: (args) => (
    <RadioGroup {...args} defaultValue="en" aria-label="language">
      <label htmlFor="lang-en" className="flex items-center gap-2 text-sm">
        <RadioGroupItem value="en" id="lang-en" />
        English
      </label>
      <label htmlFor="lang-fr" className="flex items-center gap-2 text-sm">
        <RadioGroupItem value="fr" id="lang-fr" />
        Français
      </label>
    </RadioGroup>
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const fr = canvas.getByRole('radio', { name: /français/i });
    await userEvent.click(fr);
    await expect(args.onValueChange).toHaveBeenCalledWith('fr');
  },
};
