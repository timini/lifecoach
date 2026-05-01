// Bridges Storybook stories into Vitest. Imported by vitest.config.ts as
// the setup file for the "stories" project — ensures Storybook globals,
// mocks, and a11y checks are wired before each story runs as a test.
import { setProjectAnnotations } from '@storybook/nextjs-vite';
import { beforeAll } from 'vitest';
import * as previewAnnotations from './preview';

const project = setProjectAnnotations([previewAnnotations]);

beforeAll(project.beforeAll);
