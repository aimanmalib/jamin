// The README "Size and cost" table repeats measured numbers; each row must match the record it names.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync('README.md', 'utf8');
const measured = readFileSync('docs/MEASURED.md', 'utf8');
const regtest = JSON.parse(readFileSync('examples/regtest.json', 'utf8')) as {
  transactions: Array<{ branch: string; step: string; txBytes: number; largestUnlockBytes: number; feeSats?: number }>;
};

const mainnet = JSON.parse(readFileSync('examples/mainnet.json', 'utf8')) as {
  escrows: Array<{ branch: string; steps: Array<{ step: string; feeSats?: number }> }>;
};

const num = (s: string): number => Number(s.replace(/,/g, ''));
const section = readme.slice(readme.indexOf('## Size and cost'), readme.indexOf('## Upstream contributions'));
const rows = [...section.matchAll(
  /^\| (Jamin\w+) \| `(\w+)` \| (\w+) \| ([\d,]+) \| ([\d,]+) \| ([^|]+) \| ([^|]+) \|/gm)]
  .map(([, contract = '', step = '', branch = '', unlock = '', tx = '', fee = '', mainnetFee = '']) =>
    ({ contract, step, branch, unlock: num(unlock), tx: num(tx), fee: fee.trim(), mainnetFee: mainnetFee.trim() }));

describe('README size and cost', () => {
  it('lists every function of both contracts that was measured', () => {
    expect(rows.length).toBe(14);
  });

  it('matches the regtest record row by row, with the miner fee', () => {
    for (const r of rows.filter((x) => x.branch !== 'mock')) {
      const t = regtest.transactions.find((x) => x.branch === r.branch && x.step === r.step);
      expect(t, `${r.branch} ${r.step}`).toBeDefined();
      expect([r.unlock, r.tx, num(r.fee)]).toEqual([t?.largestUnlockBytes, t?.txBytes, t?.feeSats]);
    }
  });

  it('takes the mock rows from the escrow contract sizes in docs/MEASURED.md', () => {
    const sizes = measured.slice(measured.indexOf('## Escrow contract sizes'), measured.indexOf('## Sabotage'));
    for (const r of rows.filter((x) => x.branch === 'mock')) {
      const line = `| ${r.contract} | ${r.step} | ${r.tx.toLocaleString('en')} |`;
      expect(sizes, line).toContain(line);
      expect(sizes).toContain(`${r.unlock.toLocaleString('en')} / 10,000`);
    }
  });

  it('takes the mainnet fee of each escrow call from examples/mainnet.json', () => {
    for (const r of rows) {
      const step = mainnet.escrows.find((e) => e.branch === r.branch)?.steps.find((s) => s.step === r.step);
      if (step?.feeSats === undefined) expect(r.mainnetFee, `${r.contract} ${r.step}`).toBe('not run on mainnet');
      else expect(num(r.mainnetFee), `${r.contract} ${r.step}`).toBe(step.feeSats);
    }
  });
});
