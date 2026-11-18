// The feature table of docs/FEATURES.md: each SolidCash feature with where the contracts use it and the test that
// exercises it. Parsed from the document so the page and the document cannot drift apart.

export interface SourceRef { file: string; line: number }
/** `refs` open in the contract source viewer; `code` names SDK use outside `contracts/` (shown as text). */
export interface Feature { n: number; name: string; refs: SourceRef[]; code: string[]; test: string }

const REF = /`contracts\/([\w.]+):(\d+)`/g;
const CODE = /`((?!contracts\/)[\w./-]+:\d+)`/g;

/** Rows of the first Markdown table whose first column is a number. Inline code ticks are removed from text. */
export function parseFeatures(markdown: string): Feature[] {
  const rows: Feature[] = [];
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const [n, name, where, test] = cells;
    if (cells.length !== 4 || !n || !/^\d+$/.test(n) || !name || where === undefined || test === undefined) continue;
    const refs = [...where.matchAll(REF)].map((m) => ({ file: m[1] ?? '', line: Number(m[2]) }));
    const code = [...where.matchAll(CODE)].map((m) => m[1] ?? '');
    rows.push({ n: Number(n), name: name.replace(/`/g, ''), refs, code, test: test.replace(/`/g, '') });
  }
  return rows;
}
