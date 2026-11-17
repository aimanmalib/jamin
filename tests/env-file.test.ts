import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseEnv, readEnvValue, writeEnvValueOnce } from '../src/wallet/env-file.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jamin-env-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('env file', () => {
  it('parses keys, quotes and comments', () => {
    const env = parseEnv('# note\nA=1\nB="two words"\n\nC=\n');
    expect(env.get('A')).toBe('1');
    expect(env.get('B')).toBe('two words');
    expect(env.get('C')).toBe('');
  });

  it('writes a new value with mode 0600 and keeps other lines', () => {
    const file = join(dir, '.env');
    writeFileSync(file, 'OTHER=x\nSECRET_PHRASE=\n');
    writeEnvValueOnce(file, 'SECRET_PHRASE', 'value one');
    expect(readEnvValue(file, 'SECRET_PHRASE')).toBe('value one');
    expect(readEnvValue(file, 'OTHER')).toBe('x');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8').match(/SECRET_PHRASE=/g)).toHaveLength(1);
  });

  it('refuses to replace an existing value', () => {
    const file = join(dir, '.env');
    writeEnvValueOnce(file, 'SECRET_PHRASE', 'first');
    expect(() => writeEnvValueOnce(file, 'SECRET_PHRASE', 'second')).toThrowError(/refusing to replace/);
    expect(readEnvValue(file, 'SECRET_PHRASE')).toBe('first');
  });

  it('treats a missing file as unset', () => {
    expect(readEnvValue(join(dir, 'missing'), 'X')).toBeUndefined();
  });
});
