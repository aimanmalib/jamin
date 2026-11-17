import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Reads KEY=value lines; ignores blanks and comments. */
export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    out.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2'));
  }
  return out;
}

export function readEnvValue(file: string, key: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const value = parseEnv(readFileSync(file, 'utf8')).get(key);
  return value ? value : undefined;
}

/**
 * Appends KEY=value to the env file with mode 0600. Refuses when the key already has a value,
 * so an existing wallet phrase is never replaced.
 */
export function writeEnvValueOnce(file: string, key: string, value: string): void {
  if (readEnvValue(file, key) !== undefined) throw new Error(`${key} already set in ${file}; refusing to replace it`);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const kept = before
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.trim().startsWith(`${key}=`))
    .join('\n');
  writeFileSync(file, `${kept ? `${kept}\n` : ''}${key}=${value}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}
