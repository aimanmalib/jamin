// "Wallet": a real escrow on mainnet, sold from a wallet that speaks WizardConnect (docs/decisions/0014). The seller
// pastes the connection link into their wallet, the wallet signs the role key request, the creation, the deposit and
// the release, and the buyer marks the trade paid from their own wallet in between. The page broadcasts each
// transaction and keeps no wallet key; the link is hidden once the wallet has connected.
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { config, explorerLink } from '../data/config.js';
import { STATUS, type StatusName } from '../sim/engine.js';
import { openSession, type WizSession } from '../wallet/session.js';
import { WalletTrade, parsePublicKey, tradeTerms } from '../wallet/trade.js';
import { hashQuery } from '../route.js';

type Phase = 'idle' | 'linking' | 'connected' | 'created' | 'funded';

function sats(n: bigint | number): string {
  return Number(n).toLocaleString('en');
}

/** `#/wallet?trade=…&escrow=…&buyer=…` continues an escrow made earlier (the link the tab shows after creating one). */
function resumeFrom(hash: string): { trade: string; escrow: string; buyer: string } | undefined {
  const q = hashQuery(hash);
  const trade = q.get('trade') ?? '';
  const escrow = q.get('escrow') ?? '';
  return /^[\w-]{1,64}$/.test(trade) && /^bitcoincash:[a-z0-9]{40,}$/.test(escrow)
    ? { trade, escrow, buyer: q.get('buyer') ?? '' } : undefined;
}

export function WalletTab(): ReactNode {
  const { t } = useLang();
  const [resume] = useState(() => resumeFrom(location.hash));
  const [buyerHex, setBuyerHex] = useState(resume?.buyer ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [uri, setUri] = useState('');
  const [trade, setTrade] = useState<WalletTrade | null>(null);
  const [escrow, setEscrow] = useState('');
  const [status, setStatus] = useState<StatusName | null>(null);
  const [txs, setTxs] = useState<WalletTrade['txs']>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const session = useRef<WizSession | null>(null);
  const terms = tradeTerms();
  const buyer = parsePublicKey(buyerHex);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setFailure('');
    try { await work(); } catch (e) { setFailure(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, []);

  const connect = (): void => {
    const s = openSession();
    session.current = s;
    setUri(s.uri);
    setPhase('linking');
    void run(async () => {
      const name = resume?.trade ?? `${config.walletTrade.tradeNamePrefix}-${Math.floor(Date.now() / 1000)}`;
      const w = await WalletTrade.start(s, name);
      setUri('');
      setTrade(w);
      if (resume && buyer) {
        await w.resume(resume.escrow, buyer);
        setEscrow(resume.escrow);
        setStatus(STATUS[Number(await w.status())] ?? null);
        setPhase('funded');
      } else {
        setPhase('connected');
      }
    });
  };

  const step = (work: (w: WalletTrade) => Promise<void>, next?: Phase) => (): void => {
    if (!trade) return;
    void run(async () => {
      await work(trade);
      setTxs([...trade.txs]);
      if (trade.sc) setStatus(STATUS[Number(await trade.status())] ?? null);
      if (next) setPhase(next);
    });
  };

  return (
    <>
      <h1>{t('wallet.title')}</h1>
      <p className="lede muted">{t('wallet.lede')}</p>
      <div className="sim">
        <div className="card wallet-trade">
          {resume && <p className="notice small" data-testid="wallet-resume">{t('wallet.resume', { trade: resume.trade })}</p>}
          <ul className="small muted" data-testid="wallet-terms">
            <li>{t('wallet.amount', { sats: sats(terms.amount) })}</li>
            <li>{t('wallet.panel')}</li>
            <li>{t('wallet.wallets', { names: config.walletTrade.wallets.join(', ') })}</li>
          </ul>
          <label className="field">
            <span>{t('wallet.buyerLabel')}</span>
            <input type="text" inputMode="text" autoComplete="off" spellCheck={false} value={buyerHex}
              disabled={phase !== 'idle'} onChange={(e) => setBuyerHex(e.target.value)} data-testid="buyer-key"
              aria-invalid={buyerHex !== '' && !buyer} aria-describedby="buyer-help" />
          </label>
          <p id="buyer-help" className="small muted">{buyerHex !== '' && !buyer ? t('wallet.buyerInvalid') : t('wallet.buyerHelp')}</p>
          {phase === 'idle' && (
            <button type="button" className="btn btn-primary" disabled={!buyer} onClick={connect}
              data-testid="wallet-connect">{t('wallet.connect')}</button>
          )}
          {phase === 'linking' && uri !== '' && (
            <div className="wallet" data-testid="wallet-link-box">
              <p className="small">{t('wallet.linkNote')}</p>
              <input type="text" readOnly value={uri} className="wallet-link" aria-label={t('wallet.linkLabel')}
                data-testid="wallet-link" onFocus={(e) => e.target.select()} />
              <p className="small muted">{busy ? t('wallet.waiting') : ''}</p>
            </div>
          )}
          {trade && (
            <div className="wallet" data-testid="wallet-connected">
              <p className="small">{t('wallet.connected', { name: trade.walletName || '?' })}</p>
              <p className="small muted">{t('wallet.address')} <span className="txid" data-testid="wallet-address">{trade.seller.address}</span></p>
              <p className="small muted">{t('wallet.roleKey')} <span className="txid" data-testid="role-key">{
                Array.from(trade.seller.role.publicKey, (b) => b.toString(16).padStart(2, '0')).join('')}</span></p>
              <p className="small muted">{t('wallet.tradeName')} <span className="txid" data-testid="trade-name">{trade.trade}</span></p>
            </div>
          )}
          <div className="actions">
            {phase === 'connected' && buyer && (
              <button type="button" className="btn btn-primary" disabled={busy} data-testid="wallet-create"
                onClick={step(async (w) => { await w.create(buyer); setEscrow(await w.address()); }, 'created')}>
                {t('wallet.create')}</button>
            )}
            {phase === 'created' && (
              <button type="button" className="btn btn-primary" disabled={busy} data-testid="wallet-fund"
                onClick={step(async (w) => { await w.fund(); }, 'funded')}>{t('wallet.fund')}</button>
            )}
            {phase === 'funded' && (
              <>
                <button type="button" className="btn" disabled={busy} data-testid="wallet-refresh"
                  onClick={step(async () => Promise.resolve())}>{t('wallet.refresh')}</button>
                <button type="button" className="btn btn-primary" disabled={busy || status !== 'paid'}
                  data-testid="wallet-release" onClick={step(async (w) => { await w.release(); })}>{t('wallet.release')}</button>
              </>
            )}
          </div>
          {busy && phase !== 'linking' && <p className="small muted" role="status">{t('wallet.signInWallet')}</p>}
          {failure && <p role="alert" className="small" data-testid="wallet-error">{t('wallet.failed', { message: failure })}</p>}
        </div>
        <div className="card">
          <h2 className="h3">{t('wallet.escrowTitle')}</h2>
          {escrow === '' ? <p className="muted">{t('wallet.noEscrow')}</p> : (
            <>
              <p className="small"><a className="txid" data-testid="escrow-address"
                href={explorerLink(config.explorer.mainnetAddress, escrow)}>{escrow}</a></p>
              {status && <p className="state-line">{t('try.statusLabel')} <span className="status-pill"
                data-testid="wallet-status" data-status={status}>{t(`states.${status}`)}</span></p>}
              {status === 'funded' && <p className="small muted">{t('wallet.waitBuyer')}</p>}
              {trade && <p className="small muted">{t('wallet.resumeLink')} <a className="txid" data-testid="resume-link"
                href={`#/wallet?trade=${trade.trade}&escrow=${escrow}&buyer=${buyerHex.trim()}`}>{t('wallet.resumeLinkText')}</a></p>}
            </>
          )}
          <ol className="escrow-steps" data-testid="wallet-txs">
            {txs.map((x) => (
              <li key={x.txid} data-step={x.step}>{t(`log.step.${x.step}`)}{' '}
                <a className="txid" href={explorerLink(config.explorer.mainnetTx, x.txid)}>{x.txid}</a></li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}
