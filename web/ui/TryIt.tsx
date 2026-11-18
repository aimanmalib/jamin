// "Try it": run a trade on the real contract in the browser. Pick who you are, press an action, read the result; a
// wrong role or a wrong moment comes back as the contract's own error name.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLang } from '../i18n.js';
import { ACTIONS, COSIGNS, type Action, type Cosign, type Actor, type Asset, type LogEntry, type Simulation, type StatusName }
  from '../sim/engine.js';
import { startSimulation } from '../sim/load.js';
import { SELLER_MODES, type SellerMode } from '../sim/seller.js';
import { StateDiagram } from './StateDiagram.js';
import { LastResult, SimLog } from './SimLog.js';
import { TermsList } from './TermsList.js';
import { WalletPanel } from './WalletPanel.js';

const ACTORS: Actor[] = ['seller', 'buyer', 'arbitrator', 'outsider'];
const ASSETS: Asset[] = ['bch', 'token'];

interface View { status: StatusName; waitLeft: number; log: LogEntry[] }

export function TryIt(): ReactNode {
  const { t } = useLang();
  const [asset, setAsset] = useState<Asset>('bch');
  const [actor, setActor] = useState<Actor>('buyer');
  const [cosign, setCosign] = useState<Cosign>('B');
  const [mode, setMode] = useState<SellerMode>('key');
  const [sim, setSim] = useState<Simulation | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  const refresh = useCallback(async (s: Simulation) => {
    setView({ status: await s.status(), waitLeft: await s.waitLeft(), log: [...s.log] });
  }, []);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setFailure('');
    try { await work(); } catch (e) { setFailure(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, []);

  const start = (): void => {
    void run(async () => {
      const s = await startSimulation(asset, mode);
      setSim(s);
      await refresh(s);
    });
  };
  const act = (a: Action): void => { if (sim) void run(async () => { await sim.act(actor, a, cosign); await refresh(sim); }); };
  const wait = (): void => { if (sim) void run(async () => { await sim.passTime(); await refresh(sim); }); };

  useEffect(() => { setSim(null); setView(null); }, [asset, mode]);

  return (
    <>
      <h1>{t('try.title')}</h1>
      <p className="lede muted">{t('try.lede')}</p>
      <div className="sim">
        <div className="card">
          <fieldset className="seg">
            <legend>{t('try.assetLegend')}</legend>
            {ASSETS.map((a) => (
              <label key={a}>
                <input type="radio" name="asset" value={a} checked={asset === a} onChange={() => setAsset(a)} />
                <span>{t(`try.asset.${a}`)}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="seg">
            <legend>{t('try.sellerLegend')}</legend>
            {SELLER_MODES.map((m) => (
              <label key={m}>
                <input type="radio" name="seller" value={m} checked={mode === m} onChange={() => setMode(m)} />
                <span>{t(`try.seller.${m}`)}</span>
              </label>
            ))}
          </fieldset>
          <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
            {sim ? t('try.restart') : t('try.start')}
          </button>
          {busy && <p role="status" className="muted small">{t('try.working')}</p>}
          {failure && <p role="alert" className="small">{t('try.failed', { message: failure })}</p>}
          {sim && view && (
            <>
              <p className="state-line">
                {t('try.statusLabel')} <span className="status-pill" data-testid="status">{t(`states.${view.status}`)}</span>
              </p>
              <TermsList sim={sim} waitLeft={view.waitLeft} />
              <WalletPanel sim={sim} />
              <fieldset className="seg">
                <legend>{t('try.actorLegend')}</legend>
                {ACTORS.map((a) => (
                  <label key={a}>
                    <input type="radio" name="actor" value={a} checked={actor === a} onChange={() => setActor(a)} />
                    <span>{t(`roles.${a}`)}</span>
                  </label>
                ))}
              </fieldset>
              {actor === 'arbitrator' && (
                <fieldset className="seg">
                  <legend>{t('try.panelLegend')}</legend>
                  <p className="small muted">{t('try.panelNote')}</p>
                  {COSIGNS.map((c) => (
                    <label key={c}>
                      <input type="radio" name="cosign" value={c} checked={cosign === c} onChange={() => setCosign(c)} />
                      <span>{t(`try.cosign.${c}`)}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <h2 className="h3">{t('try.actionsTitle', { role: t(`roles.${actor}`) })}</h2>
              <div className="actions">
                {ACTIONS.map((a) => (
                  <button key={a} type="button" className="btn" disabled={busy} onClick={() => act(a)} data-action={a}>
                    {t(`actions.${a}.label`)}
                    <small>{t(`actions.${a}.who`)}</small>
                  </button>
                ))}
                <button type="button" className="btn" disabled={busy} onClick={wait} data-action="wait">
                  {t('actions.wait.label')}
                  <small>{t('actions.wait.who')}</small>
                </button>
              </div>
              <LastResult entry={view.log[view.log.length - 1]} />
            </>
          )}
        </div>
        <div className="card">
          <StateDiagram current={view?.status} />
          <h2 className="h3">{t('try.logTitle')}</h2>
          {view ? <SimLog log={view.log} /> : <p className="muted">{t('try.empty')}</p>}
        </div>
      </div>
    </>
  );
}
