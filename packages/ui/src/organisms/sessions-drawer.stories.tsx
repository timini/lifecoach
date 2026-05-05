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

/**
 * Repro fixture for the "drawer is blank but state has 9 sessions" bug
 * (issue tracked in PR #46). Uses the exact production sessionId shape
 * (`${uid}-YYYY-MM-DD`) and the same 9-row spread the user sees on dev.
 * If this story renders the headers + 9 list items, the rendering layer
 * is fine and the bug is in the deployed build (CSS regression, stale
 * chunk, hydration). If it fails, we have a component bug to fix.
 */
const UID = 'T2glMtM0R4X3K9UZWhPcIN2M0Ou2';
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
const prodShapedSessions = Array.from({ length: 9 }, (_, i) => ({
  sessionId: `${UID}-${day(i)}`,
  lastUpdateTime: Date.now() - i * 24 * 60 * 60_000,
}));

export const ProdShape9Sessions: Story = {
  args: {
    open: true,
    onOpenChange: fn(),
    onSelect: fn(),
    sessions: prodShapedSessions,
    activeSessionId: prodShapedSessions[0]?.sessionId ?? '',
    todaySessionId: prodShapedSessions[0]?.sessionId ?? '',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The drawer header should always be present.
    await expect(canvas.getByText(/previous chats/i)).toBeInTheDocument();
    // 9 sessions → 9 buttons that fire onSelect, plus 1 close button.
    const buttons = canvas.getAllByRole('button');
    // close button + 9 session items + (maybe backdrop button when open)
    await expect(buttons.length).toBeGreaterThanOrEqual(10);
    // At least one bucket header — Today / Yesterday / This week / Earlier.
    const headers = canvas.queryAllByText(/today|yesterday|this week|earlier/i);
    await expect(headers.length).toBeGreaterThan(0);
  },
};
