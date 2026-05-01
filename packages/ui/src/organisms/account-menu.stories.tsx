import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { AccountMenu } from './account-menu';

const meta: Meta<typeof AccountMenu> = {
  title: 'Organisms/AccountMenu',
  component: AccountMenu,
};

export default meta;

type Story = StoryObj<typeof AccountMenu>;

export const Anonymous: Story = {
  args: {
    state: 'anonymous',
    affordances: ['sign_in_with_google_button'],
    user: {
      displayName: null,
      email: null,
      photoURL: null,
      uid: 'anon-uid',
      isAnonymous: true,
    },
    onOpenSettings: fn(),
    onSignOut: fn(),
    onGoogleSignIn: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button')).toBeInTheDocument();
  },
};

export const SignedIn: Story = {
  args: {
    state: 'google_linked',
    affordances: ['connect_workspace_button'],
    user: {
      displayName: 'Tim Richardson',
      email: 'tim@rewire.it',
      photoURL: null,
      uid: 'user-1',
      isAnonymous: false,
    },
    onOpenSettings: fn(),
    onSignOut: fn(),
    onConnectWorkspace: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button')).toBeInTheDocument();
  },
};
