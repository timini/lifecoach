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

/**
 * Demonstrates the per-leaf modified-at timestamps. The settings page
 * derives this map from the audit log returned by GET /api/profile. Flat
 * top-level keys here so both stamps are visible without expanding any
 * collapsed group; the dotted-path key still drives the lookup.
 */
export const WithModifiedAt: Story = {
  args: {
    value: {
      name: 'Wren',
      city: 'London',
    },
    onChange: () => {},
    modifiedAtByPath: {
      name: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      city: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/m ago/)).toBeInTheDocument();
    await expect(canvas.getByText(/d ago/)).toBeInTheDocument();
  },
};
