// deploy/demo-restage-cron.sh `pasang` / `buang` edit the crontab through the host's cron tools (decision 0029), never with
// `crontab -l | grep -v TAG | crontab -`: that pattern installs an empty crontab when `crontab -l` fails, and two writers at
// the same time drop each other's lines. The behaviour tests run only where the tools exist, always on a fake crontab file
// (CRON_FAIL) with a `crontab` shim that fails, so the real crontab is never read or written.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = new URL('../deploy/demo-restage-cron.sh', import.meta.url).pathname;
const script = readFileSync(scriptPath, 'utf8');
const code = script.split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
const TAG = '# jamin-demo-restage';
const ADD = '/home/claude/bin/cron-tambah-baris';
const REMOVE = '/home/claude/bin/cron-buang-tag';
const oldPattern = code.some((l) => /\|\s*crontab\s+-(\s|$)/.test(l));
const tools = existsSync(ADD) && existsSync(REMOVE);

describe('demo-restage-cron.sh crontab edits (static)', () => {
  it('test_0 no longer pipes into `crontab -`', () => {
    expect(oldPattern).toBe(false);
  });
  it('test_0 calls both host cron tools by full path, without hiding their exit code', () => {
    expect(code.some((l) => l.includes(ADD))).toBe(true);
    expect(code.some((l) => l.includes(REMOVE))).toBe(true);
    const silenced = code.filter((l) => l.includes('/home/claude/bin/cron-') && /\|\|\s*(true|:)(\s|;|$)|[&2]>\s*\/dev\/null/.test(l));
    expect(silenced).toEqual([]);
  });
  it('keeps the tag and the crontab line text', () => {
    expect(script).toContain(`TAG='${TAG}'`);
    expect(script).toContain('line="*/$every * * * * $HERE/demo-restage-cron.sh >> $REPO/state/demo-restage.log 2>&1 $TAG"');
  });
  it('passes bash -n', () => {
    execFileSync('bash', ['-n', scriptPath]);
  });
});

describe.skipIf(!tools || oldPattern)('demo-restage-cron.sh on a fake crontab', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  function setup(crontab: string | null) {
    const root = mkdtempSync(join(tmpdir(), 'jamin-cron-'));
    dirs.push(root);
    for (const d of ['repo/deploy', 'repo/config', 'home/bin', 'backups']) mkdirSync(join(root, d), { recursive: true });
    copyFileSync(scriptPath, join(root, 'repo/deploy/demo-restage-cron.sh'));
    chmodSync(join(root, 'repo/deploy/demo-restage-cron.sh'), 0o755);
    copyFileSync(new URL('../config/demo.json', import.meta.url).pathname, join(root, 'repo/config/demo.json'));
    writeFileSync(join(root, 'repo/deploy/hos.env'), `NODE_BIN=${process.execPath}\n`);
    // Any call to the real crontab command is recorded and fails.
    writeFileSync(join(root, 'home/bin/crontab'), `#!/bin/sh\necho "$*" >> "${root}/shim-called"\nexit 99\n`);
    chmodSync(join(root, 'home/bin/crontab'), 0o755);
    const fake = join(root, 'crontab.txt');
    if (crontab === null) mkdirSync(fake); else writeFileSync(fake, crontab);
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(([k, v]) => !k.startsWith('GIT_') && !k.startsWith('CRON_') && v !== undefined),
    ) as Record<string, string>;
    Object.assign(env, {
      HOME: join(root, 'home'), PATH: `${join(root, 'home/bin')}:/usr/bin:/bin`, CRON_FAIL: fake,
      CRON_BIN: join(root, 'home/bin/crontab'), CRON_KUNCI: join(root, 'lock'), CRON_SANDARAN: `${join(root, 'backups')}/`,
    });
    const run = (arg: string) => spawnSync(join(root, 'repo/deploy/demo-restage-cron.sh'), [arg], { env, encoding: 'utf8' });
    const every = JSON.parse(readFileSync(join(root, 'repo/config/demo.json'), 'utf8')).pool.restageEveryMinutes;
    const line = `*/${every} * * * * ${root}/repo/deploy/demo-restage-cron.sh >> ${root}/repo/state/demo-restage.log 2>&1 ${TAG}`;
    return { root, fake, run, line, shim: () => existsSync(join(root, 'shim-called')) };
  }
  const others = '0 3 * * * /x/a # other-A\n15 * * * * /x/b # other-B\n';

  it('pasang replaces an older tagged line and keeps the other lines in order', () => {
    const t = setup(`0 3 * * * /x/a # other-A\n*/5 * * * * /old/demo-restage-cron.sh ${TAG}\n15 * * * * /x/b # other-B\n`);
    const r = t.run('pasang');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(t.fake, 'utf8')).toBe(`${others}${t.line}\n`);
    expect(t.shim()).toBe(false);
  });
  it('pasang again changes nothing', () => {
    const t = setup(others);
    expect(t.run('pasang').status).toBe(0);
    const before = readFileSync(t.fake, 'utf8');
    const r = t.run('pasang');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(t.fake, 'utf8')).toBe(before);
    expect(t.shim()).toBe(false);
  });
  it('buang removes only the tagged line; buang again exits 0 and changes nothing', () => {
    const t = setup(`${others}${'*/10 * * * * /x/demo-restage-cron.sh '}${TAG}\n`);
    let r = t.run('buang');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(t.fake, 'utf8')).toBe(others);
    r = t.run('buang');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(t.fake, 'utf8')).toBe(others);
    expect(t.shim()).toBe(false);
  });
  it('an unreadable crontab fails with the tool exit code 2 and is not replaced', () => {
    const t = setup(null);
    expect(t.run('pasang').status).toBe(2);
    expect(t.run('buang').status).toBe(2);
    expect(t.shim()).toBe(false);
  });
});
