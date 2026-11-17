import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ElectrumServer {
  hostname: string;
  port: number;
  scheme: 'wss' | 'ws';
  timeoutMs: number;
}

export type Role = 'seller' | 'buyer' | 'arbitrator' | 'feeRecipient';

export interface JaminConfig {
  electrum: { mainnet: ElectrumServer };
  explorer: { mainnetTx: string; mainnetAddress: string };
  wallet: {
    mnemonicEnv: string;
    envFile: string;
    derivationBase: string;
    roles: Record<Role, number>;
    receiveIndex: number;
  };
  mainnet: {
    budgetSats: number;
    ledgerFile: string;
    fundingRequest: { bchSats: number; pusd: string };
    escrowAmountSats: number;
    minFundingSats: number;
  };
  tokens: { pusd: { symbol: string; category: string; decimals: number } };
  escrow: {
    feeBps: number;
    disputeFeeSats: number;
    sellerWaitingTimeSeconds: number;
    minSellerWaitingTimeSeconds: number;
  };
}

/** Absolute path of the repository root (this file lives in src/). */
export const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function loadConfig(path = new URL('../config/jamin.json', import.meta.url)): JaminConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as JaminConfig;
}
