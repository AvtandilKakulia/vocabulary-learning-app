import { defineConfig } from 'vitest/config';
import baseline from '../../vitest.config';

// Opt-in audit only. The unchanged application suite still collects src/ only.
export default defineConfig({
  ...baseline,
  test: { ...baseline.test, include: ['experiments/r4-func-01/*.probe.tsx'] },
});
