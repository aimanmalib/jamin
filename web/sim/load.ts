// Loads the compiled artifacts and the simulator engine on demand, so the first screen does not carry them.
import type { Artifact } from '@solidcash/solidcash';
import type { Asset, SimTerms, Simulation } from './engine.js';
import { config } from '../data/config.js';

/** Escrow terms of the simulator, from config/jamin.json. */
export function simTerms(asset: Asset): SimTerms {
  const e = config.escrow;
  const s = config.simulator;
  return {
    amount: BigInt(asset === 'bch' ? s.bchAmountSats : s.tokenAmount), feeBps: BigInt(e.feeBps),
    disputeFee: BigInt(e.disputeFeeSats), waitSeconds: BigInt(e.sellerWaitingTimeSeconds),
    reserve: BigInt(e.containerReserveSats),
  };
}

// Globbed rather than imported, so type checking does not need the artifacts (they are build outputs).
const ARTIFACTS = import.meta.glob<Artifact>('../../artifacts/solidcash/Jamin*Escrow.json', { import: 'default' });

async function artifact(name: string): Promise<Artifact> {
  const load = ARTIFACTS[`../../artifacts/solidcash/${name}.json`];
  if (!load) throw new Error(`artifact ${name} missing: run npm run build`);
  return load();
}

export async function startSimulation(asset: Asset): Promise<Simulation> {
  const [{ Simulation: Sim }, bch, token] = await Promise.all([
    import('./engine.js'), artifact('JaminEscrow'), artifact('JaminTokenEscrow'),
  ]);
  return Sim.start({ bch, token }, asset, simTerms(asset));
}
