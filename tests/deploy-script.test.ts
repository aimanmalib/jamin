// deploy/deploy.sh changes into deploy/ and, when the browser check fails, runs itself again with --rollback. The
// path it runs must still point at the script after the cd (run as `deploy/deploy.sh` from the repository root).
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('deploy.sh rollback path', () => {
  it('re-runs itself through a path that is valid after changing into deploy/', () => {
    const exec = /exec "\$(\w+)" --rollback/.exec(script);
    expect(exec, 'rollback re-exec').not.toBeNull();
    const variable = exec?.[1] ?? '';
    // The script up to its first use of hos.env, then a check that the re-exec target exists from there.
    const preamble = script.slice(0, script.indexOf('[ -r hos.env ]'));
    const root = mkdtempSync(join(tmpdir(), 'jamin-deploy-'));
    dirs.push(root);
    mkdirSync(join(root, 'deploy'));
    const copy = join(root, 'deploy', 'deploy.sh');
    writeFileSync(copy, `${preamble}\ntest -f "$${variable}" && echo found\n`);
    chmodSync(copy, 0o755);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
    const out = execFileSync('bash', ['-c', 'deploy/deploy.sh || true'], { cwd: root, env, encoding: 'utf8' });
    expect(out.trim()).toBe('found');
  });
});
