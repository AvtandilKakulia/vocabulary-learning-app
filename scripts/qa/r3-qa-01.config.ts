import base from '../../vitest.config';

// Opt-in audit probes; the normal 692-test suite and its timeouts stay unchanged.
export default { ...base, test: { ...base.test, include: ['scripts/qa/r3-qa-01.probes.test.tsx'] } };
