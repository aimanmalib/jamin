// Why the demo pool is closed (decision 0021). No Node import here: the site's type check reads it too.
// `funds`: the demo wallet is too short to stage; the cron stages again by itself once it is restocked.
// `budget`, `ended`, `limit`: final (pool budget used up, past restageUntil, escrow limit reached).
export const CLOSED_REASONS = ['funds', 'budget', 'ended', 'limit'] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];
