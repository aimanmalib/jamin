// The running escrow's terms: amount, fee, dispute fee and the seller's waiting time.
import type { ReactNode } from 'react';
import { useLang } from '../i18n.js';
import type { Simulation } from '../sim/engine.js';
import { config } from '../data/config.js';

export function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const s = value.toString().padStart(decimals + 1, '0');
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

export function TermsList({ sim, waitLeft }: { sim: Simulation; waitLeft: number }): ReactNode {
  const { t } = useLang();
  const s = config.simulator;
  const amount = sim.asset === 'bch' ? t('units.sats', { n: sim.terms.amount.toLocaleString('en') })
    : `${formatUnits(sim.terms.amount, s.tokenDecimals)} ${s.tokenSymbol}`;
  const fee = sim.asset === 'bch' ? t('units.sats', { n: sim.fee.toLocaleString('en') })
    : `${formatUnits(sim.fee, s.tokenDecimals)} ${s.tokenSymbol}`;
  return (
    <dl className="terms">
      <dt>{t('terms.amount')}</dt><dd>{amount}</dd>
      <dt>{t('terms.fee', { bps: sim.terms.feeBps.toString() })}</dt><dd>{fee}</dd>
      <dt>{t('terms.disputeFee')}</dt><dd>{t('units.sats', { n: sim.terms.disputeFee.toLocaleString('en') })}</dd>
      <dt>{t('terms.wait')}</dt>
      <dd className="plain">{waitLeft > 0 ? t('terms.waitLeft', { minutes: Math.ceil(waitLeft / 60) }) : t('terms.waitOver')}</dd>
    </dl>
  );
}
