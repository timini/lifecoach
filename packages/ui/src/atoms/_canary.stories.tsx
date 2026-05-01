import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

/**
 * Pipeline canary — proves Storybook + addon-vitest is wired:
 *   1. Storybook can find a story under packages/ui/src/{atoms,…}.
 *   2. Vitest can run the story's `play()` and assert against the DOM.
 *   3. Tailwind v4 tokens flow through (the rendered span uses bg-accent).
 *
 * The leading `_` in the filename keeps it out of coverage globs.
 */
function CanarySwatch() {
  return (
    <div className="flex flex-col gap-2 p-4">
      <span data-testid="canary-label" className="text-sm text-muted-foreground">
        ui-rebuild canary
      </span>
      <span
        data-testid="canary-swatch"
        className="h-10 w-32 rounded-[var(--radius-container)] bg-accent"
      />
    </div>
  );
}

const meta: Meta<typeof CanarySwatch> = {
  title: 'Foundation/Canary',
  component: CanarySwatch,
};

export default meta;

type Story = StoryObj<typeof CanarySwatch>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('canary-label')).toHaveTextContent('ui-rebuild canary');
    await expect(canvas.getByTestId('canary-swatch')).toBeInTheDocument();
  },
};
