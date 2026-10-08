import { rm } from 'node:fs/promises';

// Resolve from this script so cleanup stays in the project even from another cwd.
const projectRoot = new URL('../', import.meta.url);
const artifacts = [
  'dist',
  'coverage',
  '.eslintcache',
  'node_modules/.vite',
  'node_modules/.vite-temp',
  'node_modules/.tmp',
];

for (const artifact of artifacts) {
  await rm(new URL(artifact, projectRoot), { recursive: true, force: true });
}
