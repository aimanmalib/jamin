import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ElectrumServer {
  hostname: string;
  port: number;
  scheme: 'wss' | 'ws';
  timeoutMs: number;
}

/** `arbitrator`, `arbiterB` and `arbiterC` are the arbitration panel, in contract key order. */
export type Role = 'seller' | 'buyer' | 'arbitrator' | 'arbiterB' | 'arbiterC' | 'feeRecipient';

export interface JaminConfig {
  site: { url: string; defaultLanguage: string; languages: string[] };
  electrum: { mainnet: ElectrumServer };
  explorer: { mainnetTx: string; mainnetAddress: string };
  wallet: {
    mnemonicEnv: string;
    envFile: string;
    derivationBase: string;
    roles: Record<Role, number>;
    receiveIndex: number;
  };
  /** Signing with a connected wallet (docs/decisions/0009). */
  walletSigning: {
    /** The message a wallet signs for a role key; fields {site}, {role} and {trade}. */
    roleKeyMessage: string;
  };
  mainnet: {
    budgetSats: number;
    ledgerFile: string;
    fundingRequest: { bchSats: number; pusd: string };
    escrowAmountSats: number;
    minFundingSats: number;
    /** Electrum servers a mainnet run may broadcast through; the run refuses any other. */
    broadcastHosts: string[];
    feeRateSatsPerByte: number;
    /** Satoshis of the output-0 coin each deployment spends for its CashToken genesis; the change returns. */
    genesisCoinSats: number;
    /** Satoshis the buyer and the arbitrator keep for their own transaction fees and the dispute fee. */
    partyFloatSats: number;
    /** Token units traded in branch B (PUSD has two decimals: 100 = 1.00 PUSD). */
    tokenAmount: number;
    /** Funding floor of a run of branch B alone: it needs fees and container reserves, not the BCH escrows. */
    tokenRunMinFundingSats: number;
    /** Buying the branch B token from Cauldron pools (docs/decisions/0012). */
    tokenPurchase: {
      /** Active pool list of a token; {category} is replaced. The answer is checked against the chain. */
      indexerUrl: string;
      /** Most token units one purchase may buy (PUSD: 200 = 2.00). */
      maxUnits: number;
      /** Refuse a purchase when the pools ask more satoshis than this, trade fee included. */
      maxSupplySats: number;
    };
    /** An escrow waiting for its seller-cancel time between runs. */
    pendingFile: string;
    outputDir: string;
  };
  regtest: {
    image: string;
    container: string;
    rpcPort: number;
    cpus: number;
    upgrade12ActivationTime: number;
    outputDir: string;
    /** Satoshis given to each party at the start of a regtest run. */
    partySats: number;
    /** Satoshis of the output-0 coin each deployment spends for its CashToken genesis. */
    genesisCoinSats: number;
    /** Token units traded in branch B (a two-decimal token: 200 = 2.00). */
    tokenAmount: number;
  };
  /** Every mainnet escrow and its transactions, in the shape the web app reads. */
  mainnetExamples: string;
  tokens: { pusd: { symbol: string; category: string; decimals: number } };
  escrow: {
    feeBps: number;
    disputeFeeSats: number;
    sellerWaitingTimeSeconds: number;
    minSellerWaitingTimeSeconds: number;
    /** Satoshis that open an escrow's single satoshi container at deployment; they stay when it closes. */
    containerReserveSats: number;
  };
  /** Public web server: security policy directives and the cache lifetime of hashed assets. */
  deploy: { contentSecurityPolicy: Record<string, string[]>; assetMaxAgeSeconds: number };
}

/** Absolute path of the repository root (this file lives in src/). */
export const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function loadConfig(path = new URL('../config/jamin.json', import.meta.url)): JaminConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as JaminConfig;
}
