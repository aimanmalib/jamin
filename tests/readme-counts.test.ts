// Every SolidHat test count the README states must be the latest count recorded in docs/MEASURED.md "Test count".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync('README.md', 'utf8');
const measured = readFileSync('docs/MEASURED.md', 'utf8');
const start = measured.indexOf('\n## Test count\n');
const record = start < 0 ? '' : measured.slice(start).split('\n## ')[1] ?? '';
const latest = /`solidhat test` (\d+)\s+files, (\d+) tests/.exec(record);

describe('README test counts', () => {
  it('reads the latest count from docs/MEASURED.md', () => {
    expect(latest).not.toBeNull();
  });

  it('states the measured number of SolidHat tests everywhere it gives one', () => {
    const stated = [...readme.matchAll(/(\d+) SolidHat tests|SolidHat tests \((\d+)/g)].map((m) => m[1] ?? m[2]);
    expect(stated.length).toBeGreaterThan(0);
    for (const n of stated) expect(n).toBe(latest?.[2]);
  });

  it('states the measured number of SolidHat test files', () => {
    const files = [...readme.matchAll(/SolidHat tests in (\d+) files/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(0);
    for (const n of files) expect(n).toBe(latest?.[1]);
  });
});
