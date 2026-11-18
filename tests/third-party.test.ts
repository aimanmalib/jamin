// Branch X's helpers on the SolidCash mock network: the project wallet funds the third-party wallet with an output 0
// behind the spending gate, the buyer attaches to the escrow from the public keys the page shows and marks it paid,
// and the recorded steps carry the wallet's name. The seller is a stand-in WizardConnect wallet (test/helpers).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binToHex } from '@bitauth/libauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockNetworkProvider } from '@solidcash/solidcash/network/mock';
import { gateProvider } from '../src/budget/gate.js';
import { readLedger, totalSpent } from '../src/budget/ledger.js';
import { loadArtifact, lockOf, party } from '../src/lifecycle/context.js';
import { addSteps } from '../src/lifecycle/record.js';
import { attachEscrow, branchXSteps, buyerMarksPaid, fundWallet, keysFrom } from '../src/lifecycle/third-party.js';
import { asProvider } from '../src/sdk/mock.js';
import { WizardWallet } from '../src/wallet/wizard.js';
import { createEscrow, escrowStatus, fundEscrow, releaseEscrow, walletSeller, type AddressPrefix }
  from '../src/wallet/wizard-trade.js';
import { FakeWizWallet } from '../test/helpers/wiz-wallet.js';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jamin-x-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('branch X: a third-party wallet sells, the project wallet funds it and buys', { timeout: 180_000 }, () => {
  it('funds output 0, runs the trade from the page keys and records the wallet name', async () => {
    const mock = new MockNetworkProvider({ profile: 'production' });
    const [project, buyerS, a, b, c, fees, outsider] = await mock.getSigners(7);
    if (!project || !buyerS || !a || !b || !c || !fees || !outsider) throw new Error('mock signers missing');
    const ledgerFile = join(dir, 'belanja.json');
    const gated = gateProvider(asProvider(mock), { ledgerFile, budgetSats: 2_000_000, note: 'test',
      walletLocks: new Set([project, buyerS].map((x) => binToHex(lockOf(x.address)))),
      prevout: async (txid, vout) => {
        const out = await mock.getLedgerOutput(txid, vout);
        if (!out) throw new Error(`no live output ${txid}:${vout}`);
        return out;
      } });
    const funded = await fundWallet(gated, [party(project.privateKey, gated)], outsider.address, 30_000n, 1);
    const coin = (await mock.getUtxos(outsider.address)).find((u) => u.txid === funded);
    expect(coin?.vout).toBe(0);
    expect(coin?.satoshis).toBe(30_000n);
    expect(totalSpent(readLedger(ledgerFile))).toBeGreaterThanOrEqual(30_000);

    const prefix = outsider.address.split(':')[0] as AddressPrefix;
    const wallet = new WizardWallet(new FakeWizWallet(outsider.privateKey), outsider.publicKey);
    const seller = await walletSeller(asProvider(mock), wallet, { template: 'Jamin role key {site} {role} {trade}',
      site: 'jamin.example', trade: 'x-test' }, prefix, 1_000n);
    const terms = { amount: 5_000n, feeBps: 30n, disputeFee: 5_000n, waitSeconds: 3_600n, reserve: 1_000n };
    const panel = [a, b, c].map((s) => binToHex(s.publicKey));
    const { sc, txid: created } = await createEscrow(asProvider(mock), loadArtifact('JaminEscrow'), seller,
      { buyer: buyerS.publicKey, panel: [a.publicKey, b.publicKey, c.publicKey], feeRecipientPkh: fees.pkh }, terms,
      BigInt(mock.getBlockTime()) + 3_600n, 5_000n);
    const fund = await fundEscrow(sc, seller, terms.amount);
    const escrow = await sc.getAddress();

    const keys = { seller: binToHex(seller.role.publicKey), buyer: binToHex(buyerS.publicKey), panel,
      feeRecipientPkh: binToHex(fees.pkh) };
    await expect(attachEscrow(gated, escrow, keysFrom({ ...keys, buyer: binToHex(a.publicKey) }))).rejects.toThrow(/do not give/);
    const attached = await attachEscrow(gated, escrow, keysFrom(keys));
    const paid = await buyerMarksPaid(attached, party(buyerS.privateKey, gated));
    expect(await escrowStatus(sc)).toBe(2n);
    const release = await releaseEscrow(sc, seller);
    expect(await escrowStatus(sc)).toBe(4n);

    const steps = branchXSteps('X', escrow, 'Cashonize v0.15.2', { createEscrow: created, fund, release }, paid);
    const record = addSteps({ network: 'mainnet', escrows: [] }, steps);
    expect(record.escrows).toHaveLength(1);
    expect(record.escrows[0]?.address).toBe(escrow);
    expect(record.escrows[0]?.steps.map((s) => ('wallet' in s ? s.wallet : undefined)))
      .toEqual(['Cashonize v0.15.2', 'Cashonize v0.15.2', undefined, 'Cashonize v0.15.2']);
  });
});
