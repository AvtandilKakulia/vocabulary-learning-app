import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { sdk as priorSdk } from '../r4-auth-01b/sdk.mjs';
export const variants = ['proposal'];
export function sdk(which = 'proposal') {
  if (which !== 'proposal') throw Error('Only reviewed proposal allowed');
  const source = readFileSync(resolve('tmp/r4-auth-01c-build/node_modules/proposal/src/GoTrueClient.ts'));
  const expected = JSON.parse(readFileSync(new URL('./provenance.json', import.meta.url))).hashes.proposal;
  if (createHash('sha256').update(source).digest('hex') !== expected) throw Error('Proposal source mismatch');
  const built = JSON.parse(readFileSync(resolve('tmp/r4-auth-01c-build/proposal.json')));
  if (built.source !== expected) throw Error('Bundle/source mismatch');
  for (const suffix of ['cjs', 'mjs']) if (createHash('sha256').update(readFileSync(resolve(`tmp/r4-auth-01c-build/proposal.${suffix}`))).digest('hex') !== built.bundles[suffix]) throw Error('Bundle checksum mismatch');
  const official = priorSdk('official'); // Preserve the pinned dependency-graph/version checks.
  const req = createRequire(resolve('package.json'));
  return { version: official.version, graph: official.graph, createClient: req(resolve('tmp/r4-auth-01c-build/proposal.cjs')).createClient,
    browserEntry: resolve('tmp/r4-auth-01c-build/proposal.mjs') };
}
