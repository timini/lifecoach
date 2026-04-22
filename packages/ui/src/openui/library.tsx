'use client';

/**
 * OpenUI generative-UI library — what the model can render via <Renderer>.
 *
 * UI-2 MVP: one component (Picker). The text-first assistant messages still
 * render as plain <Bubble>. When Gemini emits a <Picker …/> tag inside its
 * response, <Renderer> takes over and draws the real widget.
 *
 * Next iterations can add more components (FactCard, GoalList, etc.) —
 * defineComponent in this file + extend the prompt in prompt.ts.
 */

import { Renderer, createLibrary, defineComponent } from '@openuidev/react-lang';
import { z } from 'zod/v4';
import { ChoicePrompt } from '../components/choice-prompt';

const Picker = defineComponent({
  name: 'Picker',
  description:
    "Shows an inline single- or multiple-choice picker. The user's " +
    'selection is sent back as the next chat message. Prefer this over ' +
    'asking open questions when the answer space is 2–8 clear options.',
  props: z.object({
    question: z.string().describe('Short question rendered above the options.'),
    options: z.array(z.string().min(1)).min(2).max(8).describe('2–8 answer options.'),
    single: z.boolean().default(true).describe('true = radio (one answer); false = checkboxes.'),
  }),
  component: ({ props }) => (
    <ChoicePrompt
      question={props.question}
      options={props.options}
      single={props.single}
      disabled={false}
      onSubmit={(answer) => {
        // Bubble the user's selection up to ChatWindow through a CustomEvent
        // so we don't have to wire every Renderer call with a React context.
        // ChatWindow listens for 'lifecoach:choice' and submits as a chat
        // message.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lifecoach:choice', { detail: answer }));
        }
      }}
    />
  ),
});

export const library = createLibrary({ components: [Picker] });

export { Renderer };
