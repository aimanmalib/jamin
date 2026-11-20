// Copies text for the WizardConnect link: the Clipboard API when the page may use it, else a hidden text area and
// the older copy command (some phone browsers). Resolves false when neither works.
export async function copyText(text: string, nav: { clipboard?: { writeText(t: string): Promise<void> } } | undefined =
  globalThis.navigator, doc: Document | undefined = globalThis.document): Promise<boolean> {
  try {
    if (nav?.clipboard) { await nav.clipboard.writeText(text); return true; }
  } catch { /* fall through to the text area */ }
  if (!doc) return false;
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  doc.body.appendChild(area);
  area.select();
  try { return doc.execCommand('copy'); } catch { return false; } finally { area.remove(); }
}
