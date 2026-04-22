/**
 * Server-safe prompt snippet (pure string — no React / no lang-core import)
 * describing the generative-UI components the model may emit.
 *
 * Hand-authored for UI-2 MVP so the agent doesn't need to import and compile
 * @openuidev/lang-core just to call generatePrompt. Keep this in sync with
 * src/openui/library.tsx — when a new component is added, extend the prompt
 * here. A future commit can replace this with a build-time generator.
 */

export const openUISystemPrompt = `
GENERATIVE_UI:
You may use OpenUI Lang to render richer interactive UI *inline* in your
response when it clearly helps the user pick an answer. OpenUI Lang tags
render as real React components in the browser.

Available components:

<Picker question="..." options="a,b,c" single="true" />
  - Renders a single-choice radio picker (single="true") or multi-select
    checkboxes (single="false").
  - 'options' is a comma-separated list, 2–8 items, each non-empty.
  - When the user picks, their selection becomes the next user message;
    DO NOT rephrase the question as text around the tag.

Rules:
- Only use <Picker/> when the answer space is 2–8 clear options and
  selecting is faster than typing. Otherwise, write plain text.
- When you emit a <Picker/>, write nothing else that turn — the picker is
  the whole response.
- Never invent tags not listed above. Unknown tags will fail to render.
- If you're unsure whether a picker fits, just write text. Plain text
  always works.
`.trim();
