// The escrow's state machine, with the current state highlighted. Words and position carry the meaning; colour only
// repeats it.
import type { ReactNode } from 'react';
import { useLang } from '../i18n.js';
import type { StatusName } from '../sim/engine.js';

interface Node { id: StatusName; x: number; y: number }
const W = 140;
const H = 38;
const NODES: Node[] = [
  { id: 'funded', x: 10, y: 110 }, { id: 'paid', x: 250, y: 110 }, { id: 'disputed', x: 490, y: 110 },
  { id: 'cancelledBySeller', x: 10, y: 220 }, { id: 'cancelledByBuyer', x: 250, y: 10 }, { id: 'released', x: 250, y: 220 },
  { id: 'resolved', x: 490, y: 220 },
];
/** [from, to, label key]; arrows run from the right or bottom edge of `from` to the left or top edge of `to`. */
const EDGES: [StatusName, StatusName, string][] = [
  ['funded', 'paid', 'markAsPaid'], ['paid', 'disputed', 'openDispute'], ['funded', 'cancelledBySeller', 'sellerCancel'],
  ['paid', 'released', 'release'], ['disputed', 'resolved', 'resolve'], ['funded', 'cancelledByBuyer', 'buyerCancel'],
  ['paid', 'cancelledByBuyer', 'buyerCancel'],
];

function centre(id: StatusName): { x: number; y: number } {
  const n = NODES.find((m) => m.id === id) ?? NODES[0] as Node;
  return { x: n.x + W / 2, y: n.y + H / 2 };
}

function path(from: StatusName, to: StatusName): { d: string; lx: number; ly: number; mid?: boolean } {
  const a = centre(from);
  const b = centre(to);
  if (a.y === b.y) return { d: `M${a.x + W / 2} ${a.y}H${b.x - W / 2 - 4}`, lx: (a.x + b.x) / 2, ly: a.y - 8, mid: true };
  if (a.x === b.x) {
    const up = b.y < a.y;
    const y1 = up ? a.y - H / 2 : a.y + H / 2;
    const y2 = up ? b.y + H / 2 + 4 : b.y - H / 2 - 4;
    return { d: `M${a.x} ${y1}V${y2}`, lx: a.x + 6, ly: (y1 + y2) / 2 + 4 };
  }
  const y1 = b.y < a.y ? a.y - H / 2 : a.y + H / 2;
  return { d: `M${a.x + 30} ${y1}V${b.y}H${b.x - W / 2 - 4}`, lx: a.x + 36, ly: b.y - 6 };
}

export function StateDiagram({ current }: { current?: StatusName | undefined }): ReactNode {
  const { t } = useLang();
  return (
    <svg className="diagram" viewBox="0 0 640 270" role="img" aria-labelledby="diagram-title">
      <title id="diagram-title">{t('diagram.title', { state: current ? t(`states.${current}`) : '-' })}</title>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="a-soft" />
        </marker>
      </defs>
      {EDGES.map(([from, to, label]) => {
        const p = path(from, to);
        return (
          <g key={`${from}-${to}`}>
            <path className="edge" d={p.d} markerEnd="url(#arrow)" />
            <text className="edge-label" x={p.lx} y={p.ly} textAnchor={p.mid ? 'middle' : 'start'}>{t(`diagram.${label}`)}</text>
          </g>
        );
      })}
      {NODES.map((n) => (
        <g key={n.id} className={`node${n.id === current ? ' current' : ''}`}>
          <rect x={n.x} y={n.y} width={W} height={H} rx="8" />
          <text x={n.x + W / 2} y={n.y + H / 2 + 4} textAnchor="middle">{t(`states.${n.id}`)}</text>
        </g>
      ))}
    </svg>
  );
}
