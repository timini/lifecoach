import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { Bubble } from '../molecules/bubble';
import { ChatShell } from './chat-shell';

const meta: Meta<typeof ChatShell> = {
  title: 'Organisms/ChatShell',
  component: ChatShell,
};

export default meta;

type Story = StoryObj<typeof ChatShell>;

export const Default: Story = {
  args: {
    header: <h1 className="text-lg font-semibold">Lifecoach</h1>,
    footer: <p className="text-xs text-muted-foreground">Footer</p>,
    children: (
      <>
        <Bubble from="assistant">Hello — what's on your mind today?</Bubble>
        <Bubble from="user">Help me ground myself.</Bubble>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/lifecoach/i)).toBeInTheDocument();
    await expect(canvas.getByText(/footer/i)).toBeInTheDocument();
    await expect(canvas.getByText(/ground myself/i)).toBeInTheDocument();
  },
};
