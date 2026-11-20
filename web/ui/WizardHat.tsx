// A wizard's hat, drawn for this site, marking WizardConnect on the connect button, the QR box and the header chip.
import type { ReactNode } from 'react';

export function WizardHat({ size = 20 }: { size?: number }): ReactNode {
  return (
    <svg className="wizard-hat" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12.6 2.2 6.4 17.4h11.4L14.4 8.6l3.4-1.9z" fill="currentColor" />
      <path d="M2.5 18.6c0-.9 4.3-1.7 9.5-1.7s9.5.8 9.5 1.7-4.3 2.4-9.5 2.4-9.5-1.5-9.5-2.4z" fill="currentColor" />
      <path d="m11.2 11.3.5 1.1 1.2.1-.9.8.3 1.2-1.1-.6-1 .6.3-1.2-.9-.8 1.2-.1z" fill="var(--lamp)" />
    </svg>
  );
}
