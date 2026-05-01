import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { Text } from './text';

const meta: Meta<typeof Text> = {
  title: 'Atoms/Text',
  component: Text,
  args: { children: 'The way to live is to look after the small things.' },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['serif-h1', 'serif-h2', 'serif-h3', 'lead', 'body', 'caption', 'code'],
    },
    tone: {
      control: 'inline-radio',
      options: ['foreground', 'muted', 'accent', 'destructive'],
    },
  },
};

export default meta;

type Story = StoryObj<typeof Text>;

export const Body: Story = {
  args: { variant: 'body' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const node = canvas.getByText(/look after the small things/i);
    await expect(node.tagName).toBe('P');
  },
};

export const SerifH1: Story = {
  args: { variant: 'serif-h1', children: 'Lifecoach' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const node = canvas.getByText('Lifecoach');
    // serif-h1 should default to the <h1> element.
    await expect(node.tagName).toBe('H1');
  },
};

export const SerifH2: Story = { args: { variant: 'serif-h2', children: 'Heading 2' } };

export const Lead: Story = {
  args: { variant: 'lead', children: 'A friend who remembers — write something.' },
};

export const Caption: Story = {
  args: { variant: 'caption', children: 'Saved 3 minutes ago' },
};

export const Scale: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Text variant="serif-h1">serif-h1 — Lifecoach</Text>
      <Text variant="serif-h2">serif-h2 — Section heading</Text>
      <Text variant="serif-h3">serif-h3 — Subheading</Text>
      <Text variant="lead">lead — A short, slightly muted sentence.</Text>
      <Text variant="body">body — The default reading paragraph size.</Text>
      <Text variant="caption">caption — Small meta line</Text>
      <Text variant="code">code — text-mono fragment</Text>
    </div>
  ),
};

export const AsSpanInsideHeading: Story = {
  args: { as: 'span', variant: 'caption', children: '· verified' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const node = canvas.getByText(/verified/i);
    await expect(node.tagName).toBe('SPAN');
  },
};
