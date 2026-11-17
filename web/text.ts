// Dotted-key lookup into a language file, with `{name}` placeholders.

export type Dict = Record<string, unknown>;

/** The text at dotted `key` in `dict`, with `{name}` placeholders filled from `vars`; the key itself when missing. */
export function lookup(dict: Dict, key: string, vars: Record<string, string | number> = {}): string {
  let node: unknown = dict;
  for (const part of key.split('.')) node = (node as Dict | undefined)?.[part];
  if (typeof node !== 'string') return key;
  return node.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
