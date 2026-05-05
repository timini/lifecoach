import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { GoalLog } from './goal-log';

const meta: Meta<typeof GoalLog> = {
  title: 'Organisms/GoalLog',
  component: GoalLog,
};

export default meta;

type Story = StoryObj<typeof GoalLog>;

const ISO_NOW = new Date(Date.now() - 30 * 60_000).toISOString();
const ISO_2DAYS = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();

export const Empty: Story = {
  args: { entries: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/no goal updates yet/i)).toBeInTheDocument();
  },
};

export const WithEntries: Story = {
  args: {
    entries: [
      { timestamp: ISO_NOW, goal: 'Walk before noon', status: 'started' },
      {
        timestamp: ISO_2DAYS,
        goal: 'Write three things I noticed',
        status: 'completed',
        note: 'Three: crow, teacup, kindness.',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/walk before noon/i)).toBeInTheDocument();
    await expect(canvas.getByText(/three things/i)).toBeInTheDocument();
  },
};
