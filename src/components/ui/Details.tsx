import type { ReactNode } from 'react';
import { Disclosure } from './Disclosure';

interface DetailsProps {
  /** Optional one-line hint shown while collapsed. */
  summary?: string;
  /** Open on first render. Use only where the detail is the point of the screen. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * The one toggle for numbers, assumptions and long explanations.
 *
 * A thin wrapper over Disclosure, so there is one accessible toggle in the app
 * rather than one per screen: it keeps a button role, an expanded/collapsed state,
 * a 52 pt touch target, and a +/− glyph so the state is never carried by colour
 * alone. Nothing here needs a new dependency.
 */
export function Details({ summary, defaultOpen = false, children }: DetailsProps) {
  return (
    <Disclosure label="Details" summary={summary} defaultOpen={defaultOpen}>
      {children}
    </Disclosure>
  );
}
