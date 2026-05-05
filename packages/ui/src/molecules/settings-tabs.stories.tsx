import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { type SettingsTab, SettingsTabs } from './settings-tabs';

const tabs: ReadonlyArray<SettingsTab> = [
  { id: 'connections', label: 'Connections' },
  { id: 'practices', label: 'Practices' },
  { id: 'profile', label: 'Profile' },
  { id: 'goals', label: 'Goals' },
  { id: 'account', label: 'Account' },
];

const meta: Meta<typeof SettingsTabs> = {
  title: 'Molecules/SettingsTabs',
  component: SettingsTabs,
  args: { tabs, activeId: 'connections', onChange: fn() },
};

export default meta;

type Story = StoryObj<typeof SettingsTabs>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const profileTab = canvas.getByRole('tab', { name: /profile/i });
    await userEvent.click(profileTab);
    await expect(args.onChange).toHaveBeenCalledWith('profile');
  },
};

export const ActiveStateUpdates: Story = {
  render: (props) => {
    const [active, setActive] = useState<string>('connections');
    return (
      <SettingsTabs
        {...props}
        activeId={active}
        onChange={(id) => {
          setActive(id);
          props.onChange?.(id);
        }}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: /goals/i }));
    const goalsTab = canvas.getByRole('tab', { name: /goals/i });
    await expect(goalsTab).toHaveAttribute('aria-selected', 'true');
  },
};
