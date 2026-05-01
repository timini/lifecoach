import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { Bubble } from '../molecules/bubble';
import { ChatPageTemplate } from './chat-page';

const meta: Meta<typeof ChatPageTemplate> = {
  title: 'Templates/ChatPageTemplate',
  component: ChatPageTemplate,
};

export default meta;

type Story = StoryObj<typeof ChatPageTemplate>;

export const Default: Story = {
  args: {
    header: <h1 className="text-lg font-semibold">Lifecoach</h1>,
    footer: <p className="text-xs text-muted-foreground">Composer goes here</p>,
    children: (
      <>
        <Bubble from="assistant">Hello — what's on your mind today?</Bubble>
        <Bubble from="user">Help me plan a calmer morning.</Bubble>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/lifecoach/i)).toBeInTheDocument();
    await expect(canvas.getByText(/composer goes here/i)).toBeInTheDocument();
  },
};
