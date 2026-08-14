import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ChatStream } from './chat-stream';

const meta: Meta<typeof ChatStream> = {
  title: 'Organisms/ChatStream',
  component: ChatStream,
  args: {
    onChoice: fn(),
    onGoogleSignIn: fn(),
    onEmailSignIn: fn(),
    onConnectWorkspace: fn(),
    onProInterest: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof ChatStream>;

export const Conversation: Story = {
  args: {
    messages: [
      { id: 'u1', role: 'user', text: 'good morning' },
      {
        id: 'a1',
        role: 'assistant',
        elements: [{ kind: 'text', text: 'Morning! What would you like to focus on today?' }],
      },
      { id: 'u2', role: 'user', text: 'help me get to the gym' },
      {
        id: 'a2',
        role: 'assistant',
        elements: [
          {
            kind: 'tool-call',
            id: 'tc1',
            name: 'log_goal_update',
            label: 'logging goal: gym',
            done: true,
            ok: true,
          },
          { kind: 'text', text: 'Logged. When are you going?' },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/good morning/i)).toBeInTheDocument();
    await expect(canvas.getByText(/morning! what would you like/i)).toBeInTheDocument();
    await expect(canvas.getByText(/logging goal: gym/i)).toBeInTheDocument();
  },
};

export const GroundedResearch: Story = {
  args: {
    messages: [
      { id: 'u1', role: 'user', text: 'What changed in Cloud Run sandboxes?' },
      {
        id: 'a1',
        role: 'assistant',
        elements: [
          {
            kind: 'text',
            text: 'Cloud Run can now launch fast, isolated execution sandboxes inside a service.',
          },
          {
            kind: 'sources',
            sources: [
              {
                title: 'Code execution in Cloud Run',
                url: 'https://docs.cloud.google.com/run/docs/code-execution',
                domain: 'docs.cloud.google.com',
              },
              {
                title: 'Cloud Run release notes',
                url: 'https://docs.cloud.google.com/run/docs/release-notes',
                domain: 'docs.cloud.google.com',
              },
            ],
          },
          {
            kind: 'search-suggestions',
            html: '<div style="font: 12px sans-serif"><a href="https://www.google.com/search?q=Cloud+Run+sandboxes">Search on Google: Cloud Run sandboxes</a></div>',
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('link', { name: /code execution in cloud run/i }),
    ).toHaveAttribute('href', 'https://docs.cloud.google.com/run/docs/code-execution');
    await expect(canvas.getByTitle('Google Search suggestions')).toHaveAttribute(
      'srcdoc',
      expect.stringContaining('https://www.google.com/search?q=Cloud+Run+sandboxes'),
    );
  },
};

export const WithChoice: Story = {
  args: {
    messages: [
      {
        id: 'a1',
        role: 'assistant',
        elements: [
          {
            kind: 'choice',
            single: true,
            question: 'Which feels more pressing right now?',
            options: ['Sleep', 'Exercise', 'Diet'],
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: /sleep/i }));
    await userEvent.click(canvas.getByRole('button', { name: /select/i }));
    await expect(args.onChoice).toHaveBeenCalledWith('a1', 'Sleep');
  },
};

export const WithAuthPrompt: Story = {
  args: {
    messages: [
      {
        id: 'a1',
        role: 'assistant',
        elements: [{ kind: 'auth', mode: 'google' }],
      },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /sign in with google/i }));
    await expect(args.onGoogleSignIn).toHaveBeenCalledOnce();
  },
};

export const WithWorkspacePrompt: Story = {
  args: {
    messages: [
      {
        id: 'a1',
        role: 'assistant',
        elements: [{ kind: 'workspace' }],
      },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /connect/i }));
    await expect(args.onConnectWorkspace).toHaveBeenCalledOnce();
  },
};

export const WithUpgradePrompt: Story = {
  args: {
    messages: [
      {
        id: 'a1',
        role: 'assistant',
        elements: [{ kind: 'upgrade' }],
      },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: /interested|upgrade/i });
    await userEvent.click(button);
    await expect(args.onProInterest).toHaveBeenCalledOnce();
  },
};

export const Pending: Story = {
  args: {
    messages: [
      { id: 'u1', role: 'user', text: 'tell me about Saturn' },
      { id: 'a1', role: 'assistant', elements: [] },
    ],
    pending: true,
    pendingLabel: 'breathing…',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('chat-stream-pending')).toBeInTheDocument();
  },
};

export const RunningToolCall: Story = {
  args: {
    messages: [
      {
        id: 'a1',
        role: 'assistant',
        elements: [
          {
            kind: 'tool-call',
            id: 'tc1',
            name: 'triage_inbox',
            label: 'triaging your inbox',
            done: false,
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/triaging your inbox/i)).toBeInTheDocument();
  },
};
