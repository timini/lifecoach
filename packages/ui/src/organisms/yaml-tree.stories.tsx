import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { YamlTree } from './yaml-tree';

const meta: Meta<typeof YamlTree> = {
  title: 'Organisms/YamlTree',
  component: YamlTree,
};

export default meta;

type Story = StoryObj<typeof YamlTree>;

export const Default: Story = {
  args: {
    value: {
      name: 'Tim',
      mood: { now: 'calm', trend: 'rising' },
      goals: ['walk before noon', 'three things noticed'],
    },
    onChange: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/^name$/)).toBeInTheDocument();
    await expect(canvas.getByText(/^mood$/)).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { value: {}, onChange: () => {} },
};
