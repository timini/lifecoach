import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Calendar, Mail } from 'lucide-react';
import { expect, within } from 'storybook/test';
import { Button } from '../atoms/button';
import { ConnectionRow } from './connection-row';

const meta: Meta<typeof ConnectionRow> = {
  title: 'Molecules/ConnectionRow',
  component: ConnectionRow,
  args: { icon: <Mail className="h-4 w-4" />, label: 'Gmail' },
};

export default meta;

type Story = StoryObj<typeof ConnectionRow>;

export const Connected: Story = {
  args: {
    status: 'Connected as tim@rewire.it',
    statusTone: 'success',
    action: (
      <Button variant="ghost" size="sm">
        Disconnect
      </Button>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/gmail/i)).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  },
};

export const Disconnected: Story = {
  args: {
    icon: <Calendar className="h-4 w-4" />,
    label: 'Calendar',
    status: 'Not connected',
    statusTone: 'warn',
    action: <Button size="sm">Connect</Button>,
  },
};

export const NoAction: Story = {
  args: { status: 'Pending verification', statusTone: 'muted' },
};
