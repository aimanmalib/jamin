// The slice of config/jamin.json the web app reads. Values change there, not in components.
import raw from '../../config/jamin.json' with { type: 'json' };

export interface WebConfig {
  site: { url: string; defaultLanguage: 'en' | 'ms' };
  explorer: { mainnetTx: string; mainnetAddress: string };
  electrum: { mainnet: { hostname: string; port: number; scheme: 'wss' | 'ws'; timeoutMs: number } };
  escrow: { feeBps: number; disputeFeeSats: number; sellerWaitingTimeSeconds: number; containerReserveSats: number };
  simulator: { bchAmountSats: number; tokenAmount: number; tokenSymbol: string; tokenDecimals: number };
  banner: {
    event: string; bounty: string; repoUrl: string; prizeAddress: string; deckUrl: string;
    videoUrl: string; videoPosterUrl: string; videoSeconds: number; note: boolean; firstCommitUrl: string;
  };
  web: { tabs: string[]; contracts: string[]; languageStorageKey: string };
  walletSigning: { roleKeyMessage: string };
  walletTrade: {
    network: 'mainnet'; dappName: string; relayUrls: string[]; amountSats: number; minGenesisCoinSats: number;
    roleKeyRequestSats: number; connectTimeoutMs: number; tradeNamePrefix: string; panel: string[];
    feeRecipientPkh: string; wallets: string[]; pollMs: number; pollRangeMs: { min: number; max: number };
    copiedMs: number;
  };
  stats: { pollMs: number; pollRangeMs: { min: number; max: number }; tickMs: number; mockPollMs: number;
    mockStartHeight: number };
  depth: { upstreamPrs: number[]; upstreamPrUrl: string;
    links: { tests: string; findings: string; upstream: string; porting: string } };
  tokens: { pusd: { symbol: string; category: string; decimals: number } };
}

export const config = raw as WebConfig;

/** The path of an absolute URL on this site, so a page served elsewhere (preview, tests) loads its own copy. */
export function sitePath(url: string): string {
  return url ? new URL(url).pathname : '';
}

/** `template` with `{txid}` / `{address}` replaced. */
export function explorerLink(template: string, value: string): string {
  return template.replace(/\{(txid|address)\}/, value);
}
