// The mainnet escrows ran the contract builds named in docs/MEASURED.md, "Final state". The compiled artifacts must
// still be those builds, or the mainnet record no longer shows the code in this repository (decision 0018).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const measured = readFileSync('docs/MEASURED.md', 'utf8');
// The first paragraph of "Final state" names the builds.
const finalState = measured.slice(measured.indexOf('## Final state\n\n') + '## Final state\n\n'.length);
const builds = finalState.slice(0, finalState.indexOf('\n\n'));

// First eight hex digits of the SHA-256 of the artifact's bytecode, as "Final state" defines them.
const buildOf = (name: string): string => {
  const artifact = JSON.parse(readFileSync(`artifacts/solidcash/${name}.json`, 'utf8')) as { bytecode: string };
  return createHash('sha256').update(artifact.bytecode).digest('hex').slice(0, 8);
};

describe('contract builds', () => {
  for (const name of ['JaminEscrow', 'JaminTokenEscrow']) {
    it(`${name} is the build the mainnet escrows ran`, () => {
      const named = new RegExp(`\`${name}\` \`([0-9a-f]{8})\``).exec(builds.replace(/\s+/g, ' '))?.[1];
      expect(named, `"Final state" names no build for ${name}`).toBeDefined();
      expect(buildOf(name), 'contract changed: run the mainnet branches again (decision 0018)').toBe(named);
    });
  }
});
