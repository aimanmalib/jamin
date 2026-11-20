// The WizardConnect link as a QR code: one SVG path of dark modules, drawn from qrcode-generator's matrix.
import qrcode from 'qrcode-generator';

export interface QrShape { size: number; path: string }

/** Modules of `text` at error correction level M, plus a quiet zone of `margin` modules on each side. */
export function qrShape(text: string, margin = 4): QrShape {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount();
  const parts: string[] = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) if (q.isDark(r, c)) parts.push(`M${c + margin} ${r + margin}h1v1h-1z`);
  }
  return { size: n + margin * 2, path: parts.join('') };
}
