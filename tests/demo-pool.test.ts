// The demo escrow pool (docs/decisions/0021-demo-escrow-pool.md): the plan stages only below `size`, within the
// budget and before the end date; a dry run sends nothing; warnings go out once; and on the SolidCash mock network a
// release by this test is followed by a restage that brings the pool back to `size`.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Artifact, NetworkProvider } from '@solidcash/solidcash';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { hexToBin } from '@bitauth/libauth';
import { demoKeys, type DemoConfig } from '../src/demo/config.js';
import { attachDemo, demoStatus, releaseDemo, type DemoStatus } from '../src/demo/escrow.js';
import { largest, stageDemo, sweepDemoKeys, type Pay, type Staged } from '../src/demo/stage.js';
import {
  POOL_LIMITS, emptyLedger, netSpent, planRestage, recordFailure, recordSuccess, restage, validPool,
  type PoolConfig, type PoolLedger, type RestageDeps,
} from '../src/demo/pool.js';
import { candidates, fetchIndex, parseIndex, pickReady } from '../web/demo/pick.js';

const jamin = JSON.parse(readFileSync('config/jamin.json', 'utf8')) as {
  escrow: { feeBps: number; disputeFeeSats: number; sellerWaitingTimeSeconds: number; containerReserveSats: number };
  walletTrade: { feeRecipientPkh: string };
};
const demo = JSON.parse(readFileSync('config/demo.json', 'utf8')) as DemoConfig;
// A fixed pool for the planning tests, so they do not follow the values in config/demo.json.
const POOL: PoolConfig = { size: 3, budgetSats: 100_000, restageUntil: '2030-01-01T00:00:00Z', maxIndex: 10,
  estimateSats: 20_000, payFeeSats: 400, indexPath: '/pool/pool.json' };
const NOW = new Date('2026-11-20T00:00:00Z');

describe('pool config', () => {
  it('keeps 3 to 5 escrows within the USD 0.30 budget, the cap the owner set', () => {
    expect(validPool(demo.pool)).toBe(demo.pool);
    expect(demo.pool.budgetSats).toBeLessThanOrEqual(POOL_LIMITS.maxBudgetSats);
    expect(POOL_LIMITS.maxBudgetSats).toBe(145_000);
    // The escrow staged before the pool (branch P) is its first member: filling the rest leaves at least 40% of the
    // budget for restaging.
    expect((demo.pool.size - 1) * demo.pool.estimateSats).toBeLessThanOrEqual(0.6 * demo.pool.budgetSats);
    expect(() => validPool({ ...POOL, size: 6 })).toThrow(/3 to 5/);
    expect(() => validPool({ ...POOL, budgetSats: 145_001 })).toThrow(/at most/);
    expect(() => validPool({ ...POOL, restageUntil: 'soon' })).toThrow(/ISO/);
  });
});

describe('planRestage', () => {
  it('stages up to size, and nothing when full', () => {
    expect(planRestage(POOL, emptyLedger(), 0, NOW)).toEqual({ stage: 3 });
    expect(planRestage(POOL, emptyLedger(), 2, NOW)).toEqual({ stage: 1 });
    expect(planRestage(POOL, emptyLedger(), 3, NOW)).toEqual({ stage: 0, stop: 'full' });
  });

  it('stages nothing at or after restageUntil', () => {
    expect(planRestage(POOL, emptyLedger(), 0, new Date(POOL.restageUntil))).toEqual({ stage: 0, stop: 'after-date' });
  });

  it('stops at the budget, counting what was swept back', () => {
    const spent: PoolLedger = { ...emptyLedger(), spentSats: 70_000 };
    expect(planRestage(POOL, spent, 0, NOW)).toEqual({ stage: 1, stop: 'budget' });
    expect(planRestage(POOL, { ...spent, spentSats: 81_000 }, 0, NOW)).toEqual({ stage: 0, stop: 'budget' });
    expect(planRestage(POOL, { ...spent, spentSats: 81_000, sweptSats: 41_000 }, 0, NOW)).toEqual({ stage: 3 });
  });

  it('counts the next staging at the dearest one measured', () => {
    const l: PoolLedger = { ...emptyLedger(), spentSats: 50_000,
      escrows: [{ address: 'a', stagedAt: '', steps: [], extra: [], costSats: 26_000 }] };
    expect(planRestage(POOL, l, 0, NOW)).toEqual({ stage: 1, stop: 'budget' });
  });

  it('stops at maxIndex', () => {
    const l: PoolLedger = { ...emptyLedger(), escrows: Array.from({ length: 9 }, (_, i) =>
      ({ address: `a${i}`, stagedAt: '', steps: [], extra: [], costSats: 1 })) };
    expect(planRestage({ ...POOL, budgetSats: 145_000 }, l, 0, NOW)).toEqual({ stage: 1, stop: 'max-index' });
  });
});

function fakeStaged(n: number): Staged {
  return { address: `escrow-${n}`, steps: [{ step: 'createEscrow', txid: `t${n}` }], extra: [], exposure: 14_546n,
    paidSats: 49_000n, returnedSats: 30_000n, payments: 3 };
}

function deps(over: Partial<RestageDeps> & { statuses?: Record<string, DemoStatus> }): RestageDeps & {
  stage: ReturnType<typeof vi.fn>; sweepBack: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> } {
  let n = 0;
  const statuses = over.statuses ?? {};
  return {
    pool: POOL, ledger: emptyLedger(), now: NOW, known: [], dry: false, feeCoinsPerEscrow: 3,
    status: async (a: string) => statuses[a] ?? 'paid',
    sweepBack: vi.fn(async () => ({ txid: 'sweep', sats: 5_000n })),
    stage: vi.fn(async () => { n += 1; return fakeStaged(n); }),
    notify: vi.fn(),
    ...over,
  } as never;
}

describe('restage', () => {
  it('sweeps, keeping the waiting escrows\' fee coins, then stages to size and counts the net cost', async () => {
    const d = deps({ known: ['p', 'q'], statuses: { p: 'paid', q: 'released' } });
    const r = await restage(d);
    expect(r.ready).toEqual(['p']);
    expect(d.sweepBack).toHaveBeenCalledWith(3);
    expect(d.stage).toHaveBeenCalledTimes(2);
    expect(r.staged).toEqual(['escrow-1', 'escrow-2']);
    // 49,000 paid - 30,000 back + 3 payments x 400 = 20,200 each; 5,000 swept back.
    expect(r.ledger.spentSats).toBe(40_400);
    expect(r.ledger.sweptSats).toBe(5_000);
    expect(netSpent(r.ledger)).toBe(35_400);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('a dry run counts and plans, and sends nothing', async () => {
    const d = deps({ dry: true, known: ['p'], statuses: { p: 'released' } });
    const r = await restage(d);
    expect(r.plan).toEqual({ stage: 3 });
    expect(d.sweepBack).not.toHaveBeenCalled();
    expect(d.stage).not.toHaveBeenCalled();
    expect(r.ledger).toEqual(emptyLedger());
  });

  it('with the budget spent stages nothing and warns once', async () => {
    const spent: PoolLedger = { ...emptyLedger(), spentSats: POOL.budgetSats };
    const d = deps({ ledger: spent, known: ['p'], statuses: { p: 'released' } });
    const r = await restage(d);
    expect(d.stage).not.toHaveBeenCalled();
    expect(d.sweepBack).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledTimes(1);
    const again = deps({ ledger: r.ledger, known: ['p'], statuses: { p: 'released' } });
    await restage(again);
    expect(again.notify).not.toHaveBeenCalled();
    expect(again.stage).not.toHaveBeenCalled();
  });

  it('after restageUntil stages nothing', async () => {
    const d = deps({ now: new Date('2030-01-01T00:00:01Z'), known: ['p'], statuses: { p: 'released' } });
    const r = await restage(d);
    expect(r.plan.stop).toBe('after-date');
    expect(d.stage).not.toHaveBeenCalled();
    expect(d.sweepBack).not.toHaveBeenCalled();
  });

  it('never spends past the budget, even when a staging costs more than counted', async () => {
    const d = deps({ known: [] });
    d.stage.mockImplementation(async () => ({ ...fakeStaged(9), paidSats: 90_000n }));
    const r = await restage(d);
    expect(d.stage).toHaveBeenCalledTimes(1);
    expect(r.ledger.spentSats).toBe(61_200);
    expect(netSpent(r.ledger)).toBeLessThanOrEqual(POOL.budgetSats);
  });

  it('warns once after three failed runs in a row, again only after a success', () => {
    const notify = vi.fn();
    let l = emptyLedger();
    for (let i = 0; i < 4; i += 1) l = recordFailure(l, 'boom', NOW, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatch(/3 runs in a row.*boom/);
    l = recordSuccess(l);
    expect(l.failures).toBe(0);
    for (let i = 0; i < 3; i += 1) l = recordFailure(l, 'boom', NOW, notify);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('keeps the largest coins', () => {
    expect([...largest([1n, 5n, 3n, 4n], 2)].sort()).toEqual([1, 3]);
    expect(largest([1n], 0).size).toBe(0);
  });
});

describe('pool on the mock network', { timeout: 900_000 }, () => {
  it('stages to size; after this test releases one, the restage stages one more', async () => {
    const artifact = JSON.parse(readFileSync('artifacts/solidcash/JaminEscrow.json', 'utf8')) as Artifact;
    const mock = new MockNetworkProvider({ profile: 'production' });
    const provider = mock as unknown as NetworkProvider;
    const [wallet] = await mock.getSigners(1);
    const back = wallet?.address ?? '';
    let n = 0;
    const pay: Pay = async (address, amounts) => {
      n += 1;
      const txid = n.toString(16).padStart(64, '0');
      return Promise.all(amounts.map((satoshis, vout) => mock.seedUtxo(address, { txid, vout, satoshis })));
    };
    const parties = { keys: demoKeys(demo, 'bchtest'), feeRecipientPkh: hexToBin(jamin.walletTrade.feeRecipientPkh) };
    const e = jamin.escrow;
    const terms = { feeBps: BigInt(e.feeBps), disputeFee: BigInt(e.disputeFeeSats),
      waitSeconds: BigInt(e.sellerWaitingTimeSeconds), reserve: BigInt(e.containerReserveSats), feeRate: 1 };
    // Room for four stagings: this test stages a full pool from empty, without branch P.
    const pool: PoolConfig = { ...demo.pool, budgetSats: 4 * demo.pool.estimateSats };
    const run = (ledger: PoolLedger): Promise<Awaited<ReturnType<typeof restage>>> => restage({
      pool, ledger, now: NOW, known: [], dry: false, feeCoinsPerEscrow: demo.feeCoinSats.length, notify: () => {},
      status: async (a) => demoStatus(await attachDemo(provider, artifact, parties, a)),
      sweepBack: (keep) => sweepDemoKeys(provider, parties, keep, back, 1),
      stage: () => stageDemo(provider, artifact, demo, parties, terms, pay, back),
    });

    const first = await run(emptyLedger());
    expect(first.staged).toHaveLength(pool.size);
    for (const x of first.ledger.escrows) {
      expect(x.costSats).toBeLessThanOrEqual(pool.estimateSats);
      expect(x.steps.map((s) => s.step)).toEqual(['createEscrow', 'fund', 'markAsPaid']);
    }
    const [released, ...waiting] = first.staged;
    if (released === undefined) throw new Error('nothing staged');
    const sent = await releaseDemo(provider, artifact, parties, released, false);
    expect(sent.sent).toBe(true);

    const second = await run(first.ledger);
    expect(second.ready).toEqual(waiting);
    expect(second.staged).toHaveLength(1);
    expect(second.swept?.sats ?? 0).toBeGreaterThan(0);
    // The escrows still waiting kept enough fee coins: each one's dry release signs without a coin split.
    for (const a of [...waiting, ...second.staged]) {
      expect(await demoStatus(await attachDemo(provider, artifact, parties, a))).toBe('paid');
      expect((await releaseDemo(provider, artifact, parties, a, true)).sent).toBe(false);
    }
    expect(netSpent(second.ledger)).toBeLessThanOrEqual(pool.budgetSats);
    console.log(`pool mock: costs ${second.ledger.escrows.map((x) => x.costSats).join(', ')}; swept ${second.ledger.sweptSats}`);
  });
});

describe('the card picks the next escrow waiting', () => {
  const P = 'bitcoincash:pwhpw9f4mvvavdjwlwykzlfurq93h24xlkd7t6h35y5s6za5v4f42fz36zzus';
  const Q = `bitcoincash:p${'q'.repeat(60)}`;
  const R = `bitcoincash:p${'r'.repeat(60)}`;

  it('reads only well-formed addresses from the pool list', () => {
    expect(parseIndex({ escrows: [Q, 'x', 3, R] })).toEqual([Q, R]);
    expect(parseIndex(null)).toEqual([]);
    expect(parseIndex({ escrows: 'no' })).toEqual([]);
    expect(candidates([P], [P, Q, R], 2)).toEqual([P, Q]);
  });

  it('a missing or failing list is no list', async () => {
    expect(await fetchIndex('/pool/pool.json', async () => new Response('', { status: 404 }))).toEqual([]);
    expect(await fetchIndex('/pool/pool.json', async () => { throw new Error('offline'); })).toEqual([]);
    expect(await fetchIndex('/pool/pool.json', async () => Response.json({ escrows: [Q] }))).toEqual([Q]);
  });

  it('offers the first paid escrow, skips the one just released, else the newest', async () => {
    const st: Record<string, string> = { [P]: 'released', [Q]: 'paid', [R]: 'paid' };
    const status = async (a: string): Promise<string> => st[a] ?? 'created';
    expect(await pickReady([P, Q, R], status)).toEqual({ address: Q, status: 'paid' });
    expect(await pickReady([P, Q, R], status, new Set([Q]))).toEqual({ address: R, status: 'paid' });
    st[R] = 'released';
    expect(await pickReady([P, Q, R], status, new Set([Q]))).toEqual({ address: R, status: 'released' });
    expect(await pickReady([], status)).toBeUndefined();
  });
});

describe('pool cron and serving', () => {
  const cron = readFileSync('deploy/demo-restage-cron.sh', 'utf8');

  it('runs one at a time, low priority, bounded, with Node from the host file and no host paths', () => {
    expect(cron).toMatch(/flock -n/);
    expect(cron).toMatch(/nice -n \d+/);
    expect(cron).toMatch(/timeout 600/);
    expect(cron).toMatch(/# jamin-demo-restage/);
    expect(cron).toMatch(/NODE_BIN/);
    expect(cron).toMatch(/-ge 22/);
    expect(cron).not.toMatch(/\/home\/|\.nvm/);
    expect(cron).toMatch(/--network mainnet/);
    expect(cron).not.toMatch(/--release-first/);
  });

  it('mounts the pool list read-only and serves it uncached', () => {
    expect(readFileSync('deploy/compose.yaml', 'utf8')).toMatch(/- \.\.\/state\/demo-public:\/srv\/jamin\/pool:ro/);
    const conf = readFileSync('deploy/nginx.conf.tmpl', 'utf8');
    const block = conf.slice(conf.indexOf('location /pool/'), conf.indexOf('location /media/'));
    expect(block).toMatch(/Cache-Control "no-store"/);
    expect(demo.pool.indexPath.startsWith('/pool/')).toBe(true);
  });
});
