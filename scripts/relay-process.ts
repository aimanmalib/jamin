// Runs scripts/relay.ts as its own process on the two files a party wrote (docs/decisions/0019-keyless-relayer.md),
// so the program that broadcasts is not the one that signed. Returns the txid the relayer printed.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { repoRoot } from '../src/config.js';
import type { Relayer } from '../src/lifecycle/context.js';

const run = promisify(execFile);

/** The txid in the relayer's `sent <txid>` line. */
export function sentTxid(stdout: string): string {
  const m = /^sent ([0-9a-f]{64})$/m.exec(stdout);
  if (!m?.[1]) throw new Error(`the relayer printed no txid: ${stdout.slice(0, 300)}`);
  return m[1];
}

export function relayProcess(dir: string, network: 'regtest' | 'mainnet'): Relayer {
  return {
    dir,
    async send(txFile, intentFile) {
      const tsx = join(repoRoot, 'node_modules', '.bin', 'tsx');
      const args = [join(repoRoot, 'scripts', 'relay.ts'), txFile, intentFile, '--send',
        ...(network === 'regtest' ? ['--network', 'regtest'] : [])];
      try {
        const { stdout } = await run(tsx, args, { cwd: repoRoot, timeout: 600_000 });
        process.stdout.write(`${stdout.trimEnd().replace(/^/gm, '  relay: ')}\n`);
        return sentTxid(stdout);
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; message: string };
        throw new Error(`relayer refused or failed: ${(err.stderr || err.stdout || err.message).trim().slice(0, 400)}`);
      }
    },
  };
}
