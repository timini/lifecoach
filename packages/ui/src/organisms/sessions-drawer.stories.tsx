import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { SessionsDrawer, SessionsDrawerTrigger } from './sessions-drawer';

const meta: Meta<typeof SessionsDrawer> = {
  title: 'Organisms/SessionsDrawer',
  component: SessionsDrawer,
};

export default meta;

type Story = StoryObj<typeof SessionsDrawer>;

const NOW = Date.now();
const sessions = [
  { sessionId: '2026-05-01-tim', lastUpdateTime: NOW },
  { sessionId: '2026-04-30-tim', lastUpdateTime: NOW - 24 * 60 * 60_000 },
  { sessionId: '2026-04-25-tim', lastUpdateTime: NOW - 6 * 24 * 60 * 60_000 },
];

export const Open: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    onSelect: fn(),
    sessions,
    activeSessionId: '2026-05-01-tim',
    todaySessionId: '2026-05-01-tim',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const yesterday = canvas.getByText(/2026-04-30-tim/);
    await userEvent.click(yesterday);
    await expect(args.onSelect).toHaveBeenCalledWith('2026-04-30-tim');
  },
};

export const Trigger: Story = {
  render: () => <SessionsDrawerTrigger onOpen={() => {}} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button')).toBeInTheDocument();
  },
};
