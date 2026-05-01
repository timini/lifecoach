#!/usr/bin/env node
/**
 * check-stories — fail if any component in packages/ui/src/{atoms,molecules,
 * organisms,templates}/ doesn't have a sibling .stories.tsx.
 *
 * Stories are how design-system components are tested + documented in this
 * repo, so a tier .tsx without a story is treated as broken. Run from
 * lefthook (pre-commit) and ci.yml.
 *
 * Files starting with `_` are exempt (canary, internal helpers).
 *
 * Exit code: 0 = all good, 1 = missing stories (filenames listed on stderr).
 */

import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tierRoots = ['atoms', 'molecules', 'organisms', 'templates'].map((tier) =>
  resolve(repoRoot, 'packages/ui/src', tier),
);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory may not exist yet (early in the rebuild). Treat as empty.
    return out;
  }
  for (const name of entries) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const missing = [];
for (const root of tierRoots) {
  const files = walk(root);
  const tsxFiles = files.filter((f) => {
    const name = basename(f);
    return (
      name.endsWith('.tsx') &&
      !name.endsWith('.stories.tsx') &&
      !name.endsWith('.test.tsx') &&
      !name.startsWith('_')
    );
  });
  for (const tsx of tsxFiles) {
    const expected = tsx.replace(/\.tsx$/, '.stories.tsx');
    if (!files.includes(expected)) {
      missing.push({ component: tsx, expectedStory: expected });
    }
  }
}

if (missing.length > 0) {
  process.stderr.write('Missing .stories.tsx for the following components:\n');
  for (const m of missing) {
    const rel = (p) => p.slice(repoRoot.length + 1);
    process.stderr.write(`  - ${rel(m.component)} (expected ${rel(m.expectedStory)})\n`);
  }
  process.stderr.write(
    '\nEvery component under atoms/molecules/organisms/templates needs a story.\n',
  );
  process.exit(1);
}

process.stdout.write('check-stories: ok\n');
