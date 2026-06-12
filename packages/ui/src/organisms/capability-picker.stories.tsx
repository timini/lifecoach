import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { CapabilityPicker, type CapabilityPickerTile } from './capability-picker';

const THREE_TILES: CapabilityPickerTile[] = [
  {
    id: 'workspace',
    title: 'Personal assistant',
    body: 'Triage your inbox, plan around your calendar, capture quick tasks straight to Google Tasks.',
    iconKey: 'workspace',
    status: 'available',
    cta: 'connect_workspace',
  },
  {
    id: 'notion',
    title: 'Task tracking',
    body: "Keep your TODOs in Notion as a tree of projects + sub-tasks. I'll keep the notes current as we work.",
    iconKey: 'notion',
    status: 'available',
    cta: 'connect_notion',
  },
  {
    id: 'career_coaching',
    title: 'Career coaching',
    body: 'Walk-through exercises and reflective reports for the career questions on your mind. (Coming soon.)',
    iconKey: 'career',
    status: 'coming_soon',
    cta: null,
  },
];

const meta: Meta<typeof CapabilityPicker> = {
  title: 'Organisms/CapabilityPicker',
  component: CapabilityPicker,
  args: { onConnect: fn() },
};

export default meta;

type Story = StoryObj<typeof CapabilityPicker>;

// Non-null-asserted accessors keep tsconfig.strict happy while
// preserving the read-by-index ergonomics in the play() bodies.
const workspaceTile = THREE_TILES[0]!;
const notionTile = THREE_TILES[1]!;
const careerTile = THREE_TILES[2]!;

export const FreshSignedInUser: Story = {
  args: { tiles: THREE_TILES },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // All three tiles render.
    await expect(canvas.getByText(/Personal assistant/i)).toBeVisible();
    await expect(canvas.getByText(/Task tracking/i)).toBeVisible();
    await expect(canvas.getByText(/Career coaching/i)).toBeVisible();

    // Clicking the workspace Connect routes the right CTA.
    const tiles = canvas.getAllByTestId('capability-tile');
    const workspaceEl = tiles[0]!;
    const workspaceConnect = within(workspaceEl).getByRole('button', { name: /^connect$/i });
    await userEvent.click(workspaceConnect);
    await expect(args.onConnect).toHaveBeenCalledWith('connect_workspace');
  },
};

export const WorkspaceAlreadyConnected: Story = {
  args: {
    tiles: [{ ...workspaceTile, status: 'connected', cta: null }, notionTile, careerTile],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Workspace tile is connected — its button is inert.
    const tiles = canvas.getAllByTestId('capability-tile');
    const workspaceEl = tiles[0]!;
    const notionEl = tiles[1]!;
    const wsBtn = within(workspaceEl).getByRole('button', { name: /connected/i });
    await expect(wsBtn).toBeDisabled();
    await userEvent.click(wsBtn, { pointerEventsCheck: 0 });
    await expect(args.onConnect).not.toHaveBeenCalled();

    // Notion tile is still actionable.
    const notionBtn = within(notionEl).getByRole('button', { name: /^connect$/i });
    await userEvent.click(notionBtn);
    await expect(args.onConnect).toHaveBeenCalledWith('connect_notion');
  },
};
