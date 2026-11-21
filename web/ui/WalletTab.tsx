// "Wallet": a real escrow on mainnet, sold from a wallet that speaks WizardConnect (docs/decisions/0014). The seller
// pastes the connection link into their wallet, the wallet signs the role key request, the creation, the deposit and
// the release, and the buyer marks the trade paid from their own wallet in between. The page broadcasts each
// transaction and keeps no wallet key; the link is hidden once the wallet has connected. The escrow's status and the
// wallet's balance stay current by themselves (docs/decisions/0022): there is no refresh button. The balance covers
// every receive and change address of the wallet, and each step is paid from the address that holds enough (0027).
// A wallet whose connection drops shows "Reconnecting..." and pauses the buttons; a wallet that ends the session, or
// stays away longer than `walletTrade.reconnectGraceMs`, ends it here too, with "Connect again" (0028).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { config, explorerLink } from '../data/config.js';
import { STATUS, type StatusName } from '../sim/engine.js';
import { parsePublicKey, tradeTerms, type TradeApi, type TradeTx } from '../wallet/trade.js';
import { walletBackend } from '../wallet/backend.js';
import { setConnectedWallet } from '../wallet/store.js';
import { usePolling } from '../wallet/poll.js';
import { hashQuery } from '../route.js';
import { WalletQr } from './WalletQr.js';
import { WizardHat } from './WizardHat.js';
import { WalletBalance, useCanCreate } from './WalletBalance.js';
import { failureText } from '../wallet/failure.js';
import { useLinkState } from '../wallet/useLink.js';
import { WalletEnded } from './WalletEnded.js';

type Phase = 'idle' | 'linking' | 'connected' | 'created' | 'funded';

/** The trade a session that ended leaves behind: connecting again with the same name continues it. */
interface Again { trade: string; escrow: string }

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
  const [trade, setTrade] = useState<TradeApi | null>(null);
  const [escrow, setEscrow] = useState('');
  const [status, setStatus] = useState<StatusName | null>(null);
  const [txs, setTxs] = useState<TradeTx[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [ended, setEnded] = useState<Again | null>(null);
  const [tried, setTried] = useState(false);
  const backend = useMemo(() => walletBackend(), []);
  const terms = tradeTerms();
  const buyer = parsePublicKey(buyerHex);
  const canCreate = useCanCreate();
  const linkState = useLinkState(trade?.link);
  const away = linkState === 'reconnecting';

  useEffect(() => {
    if (linkState !== 'ended' || !trade) return;
    setEnded({ trade: trade.trade, escrow });
    setTrade(null);
    setConnectedWallet(null);
    setPhase('idle');
  }, [linkState, trade, escrow]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setFailure('');
    try { await work(); } catch (e) { setFailure(failureText(t, e)); } finally { setBusy(false); }
  }, [t]);

  const connect = (again?: Again): void => {
    const link = backend.open();
    setUri(link.uri);
    setPhase('linking');
    setTried(true);
    void run(async () => {
      const name = again?.trade ?? resume?.trade ?? `${config.walletTrade.tradeNamePrefix}-${Math.floor(Date.now() / 1000)}`;
      let w: TradeApi;
      try {
        w = await link.start(name);
      } catch (e) {
        setUri('');
        setPhase('idle');
        throw e;
      }
      setUri('');
      setEnded(null);
      setTrade(w);
      setConnectedWallet({ name: w.walletName, address: w.sellerAddress, link: w.link,
        readBalance: () => w.balance() });
      const at = again?.escrow || resume?.escrow;
      if (at && buyer) {
        await w.resume(at, buyer);
        setEscrow(at);
        const now = STATUS[Number(await w.status())] ?? null;
        setStatus(now);
        setPhase(now === 'created' ? 'created' : 'funded');
      } else {
        setPhase('connected');
      }
    });
  };

  const step = (work: (w: TradeApi) => Promise<void>, next?: Phase) => (): void => {
    if (!trade) return;
    void run(async () => {
      await work(trade);
      setTxs([...trade.txs]);
      if (trade.hasEscrow()) setStatus(STATUS[Number(await trade.status())] ?? null);
      if (next) setPhase(next);
    });
  };

  const live = phase === 'funded' && !busy && !away && status !== 'released' && trade !== null;
  usePolling(async () => { if (trade) setStatus(STATUS[Number(await trade.status())] ?? null); }, live);

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
              disabled={phase !== 'idle' || (ended !== null && ended.escrow !== '')} onChange={(e) => setBuyerHex(e.target.value)} data-testid="buyer-key"
              aria-invalid={buyerHex !== '' && !buyer} aria-describedby="buyer-help" />
          </label>
          <p id="buyer-help" className="small muted">{buyerHex !== '' && !buyer ? t('wallet.buyerInvalid') : t('wallet.buyerHelp')}</p>
          {phase === 'idle' && ended === null && (
            <button type="button" className="btn btn-primary" disabled={!buyer} onClick={() => { connect(); }}
              data-testid="wallet-connect"><WizardHat />{t(tried && failure !== '' ? 'wallet.tryAgain' : 'wallet.connect')}</button>
          )}
          {phase === 'idle' && ended !== null && <WalletEnded disabled={!buyer} onConnect={() => { connect(ended); }} />}
          {away && <p className="wallet-reconnecting small" role="status" data-testid="wallet-reconnecting">
            <strong>{t('wallet.reconnecting')}</strong> {t('wallet.reconnectingDetail')}</p>}
          {phase === 'linking' && uri !== '' && <WalletQr uri={uri} waiting={busy} />}
          {trade && (
            <div className="wallet" data-testid="wallet-connected">
              <p className="small">{t('wallet.connected', { name: trade.walletName || '?' })}</p>
              <p className="small muted">{t('wallet.address')} <span className="txid" data-testid="wallet-address">{trade.sellerAddress}</span></p>
              <p className="small muted">{t('wallet.roleKey')} <span className="txid" data-testid="role-key">{
                Array.from(trade.roleKey, (b) => b.toString(16).padStart(2, '0')).join('')}</span></p>
              <p className="small muted">{t('wallet.tradeName')} <span className="txid" data-testid="trade-name">{trade.trade}</span></p>
              {phase === 'connected' && <WalletBalance name={trade.walletName} />}
            </div>
          )}
          <div className="actions">
            {phase === 'connected' && buyer && (
              <button type="button" className="btn btn-primary" disabled={busy || away || !canCreate} data-testid="wallet-create"
                onClick={step(async (w) => { await w.create(buyer); setEscrow(await w.address()); }, 'created')}>
                {t('wallet.create')}</button>
            )}
            {phase === 'created' && (
              <button type="button" className="btn btn-primary" disabled={busy || away} data-testid="wallet-fund"
                onClick={step(async (w) => { await w.fund(); }, 'funded')}>{t('wallet.fund')}</button>
            )}
            {phase === 'funded' && (
              <button type="button" className="btn btn-primary" disabled={busy || away || status !== 'paid'}
                data-testid="wallet-release" onClick={step(async (w) => { await w.release(); })}>{t('wallet.release')}</button>
            )}
          </div>
          {busy && phase !== 'linking' && <p className="small muted" role="status">{t('wallet.signInWallet')}</p>}
          {failure && <p role="alert" className="small" data-testid="wallet-error">{failure}</p>}
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
