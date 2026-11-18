// "Lifecycle": every escrow recorded on a real network. Mainnet escrows come from examples/mainnet.json with their
// coins read live from Electrum, block height and which steps the seller's wallet signed; until that file has
// entries the page says so. The regtest run follows, then branch R on regtest: calls the node refused.
import { useEffect, useState, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { byBranch, mainnet, regtest, type MainnetEscrow } from '../data/examples.js';
import { config, explorerLink } from '../data/config.js';
import { EscrowSteps } from './EscrowSteps.js';
import { fetchCoins, type Coins } from '../net/utxos.js';
import { StateDiagram } from './StateDiagram.js';

function LiveCoins({ address }: { address: string }): ReactNode {
  const { t } = useLang();
  const [coins, setCoins] = useState<Coins | 'error' | null>(null);
  useEffect(() => { fetchCoins(address).then(setCoins, () => setCoins('error')); }, [address]);
  if (coins === null) return <span className="muted">{t('lifecycle.reading')}</span>;
  if (coins === 'error') return <span className="muted">{t('lifecycle.readFailed')}</span>;
  return <span>{t('lifecycle.coins', { count: coins.count, sats: coins.sats.toLocaleString('en') })}</span>;
}

function MainnetEscrowCard({ e }: { e: MainnetEscrow }): ReactNode {
  const { t } = useLang();
  return (
    <article className="card">
      <h3>{t('lifecycle.branchTitle', { branch: e.branch, name: t(`lifecycle.branch.${e.branch}`) })}</h3>
      {e.address && (
        <p className="small"><a className="txid" href={explorerLink(config.explorer.mainnetAddress, e.address)}>{e.address}</a>
          {' '}<LiveCoins address={e.address} /></p>
      )}
      <EscrowSteps steps={e.steps} link />
    </article>
  );
}

export function Lifecycle(): ReactNode {
  const { t } = useLang();
  return (
    <>
      <h1>{t('lifecycle.title')}</h1>
      <p className="lede muted">{t('lifecycle.lede')}</p>
      <section aria-labelledby="diagram-h"><h2 id="diagram-h">{t('lifecycle.diagramTitle')}</h2>
        <div className="card"><StateDiagram /></div></section>
      <section aria-labelledby="mainnet-h">
        <h2 id="mainnet-h">{t('lifecycle.mainnetTitle')}</h2>
        {mainnet.escrows.length === 0
          ? <p className="notice" data-testid="mainnet-empty">{t('lifecycle.mainnetEmpty')}</p>
          : <>
            <p className="muted" data-testid="mainnet-lede">{t('lifecycle.mainnetLede')}</p>
            <div className="steps3">{mainnet.escrows.map((e) => <MainnetEscrowCard key={e.address ?? e.branch} e={e} />)}</div>
          </>}
      </section>
      <section aria-labelledby="regtest-h">
        <h2 id="regtest-h">{t('lifecycle.regtestTitle')}</h2>
        <p className="muted">{t('lifecycle.regtestNote', { node: regtest.node, date: regtest.measuredAt.slice(0, 10),
          count: regtest.transactions.length })}</p>
        {byBranch(regtest.transactions).map(([branch, rows]) => (
          <div key={branch} className="table-wrap">
            <table>
              <caption className="h3">{t('lifecycle.branchTitle', { branch, name: t(`lifecycle.branch.${branch}`) })}</caption>
              <thead><tr><th>{t('lifecycle.colStep')}</th><th>{t('lifecycle.colTx')}</th>
                <th>{t('lifecycle.colBytes')}</th><th>{t('lifecycle.colUnlock')}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.txid}><td>{t(`log.step.${r.step}`)}</td><td className="txid">{r.txid}</td>
                    <td>{r.txBytes.toLocaleString('en')}</td>
                    <td>{r.largestUnlockBytes.toLocaleString('en')} / {regtest.unlockLimitBytes.toLocaleString('en')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
      {regtest.refused && (
        <section aria-labelledby="refused-h" data-testid="regtest-refused">
          <h2 id="refused-h">{t('lifecycle.regtestRefusedTitle')}</h2>
          <p className="muted">{t('lifecycle.regtestRefusedNote', { node: regtest.refused.node,
            date: regtest.refused.measuredAt.slice(0, 10) })}</p>
          <article className="card">
            <h3>{t('lifecycle.branchTitle', { branch: regtest.refused.branch,
              name: t(`lifecycle.branch.${regtest.refused.branch}`) })}</h3>
            <EscrowSteps steps={regtest.refused.steps} link={false} />
          </article>
        </section>
      )}
    </>
  );
}
