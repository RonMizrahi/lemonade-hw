import type { ExternalLookupState, ExternalLookupStatus } from '../api/types';

/** Per-status presentation: variant class + label + neutral fallback meta. */
const STATUS: Record<ExternalLookupStatus, { cls: string; label: string; meta: string }> = {
  not_started: { cls: '', label: 'Property lookup', meta: 'Starts once you add your address' },
  loading: { cls: 'badge--loading', label: 'Checking your property…', meta: 'Running in the background' },
  completed: { cls: 'badge--completed', label: 'Property found', meta: '' },
  failed: {
    cls: 'badge--failed',
    label: "Couldn't reach the property service",
    meta: 'You can try again',
  },
  permanently_failed: {
    cls: 'badge--fallback',
    label: 'Using estimated property details',
    meta: "We couldn't verify it, so we'll estimate — you can still finish",
  },
};

interface LookupBadgeProps {
  lookup: ExternalLookupState;
  /** Whether a write is in flight — disables the Retry action. */
  busy: boolean;
  onRetry: () => void;
}

/** Reads a value from the lookup result as a plain string if present and non-empty. */
function field(result: Record<string, unknown> | null, key: string): string | null {
  const v = result?.[key];
  if (v === null || v === undefined || v === '') {
    return null;
  }
  return String(v);
}

/** Builds a short "Built 1998 · 2,100 sqft · Flood zone X" peek from the fetched property data. */
function peek(result: Record<string, unknown> | null): string {
  const parts: string[] = [];
  const built = field(result, 'yearBuilt'); // a year — never thousands-separated
  const sqftRaw = result?.squareFeet;
  const sqft = typeof sqftRaw === 'number' ? sqftRaw.toLocaleString('en-US') : field(result, 'squareFeet');
  const zone = field(result, 'floodZone');
  if (built) parts.push(`Built ${built}`);
  if (sqft) parts.push(`${sqft} sqft`);
  if (zone) parts.push(`Flood zone ${zone}`);
  return parts.join(' · ');
}

/** Small status glyph. Loading is a pulsing dot; the rest are inline icons. */
function Glyph({ status }: { status: ExternalLookupStatus }) {
  if (status === 'loading') {
    return <span className="badge__pulse" />;
  }
  if (status === 'completed') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (status === 'failed' || status === 'permanently_failed') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8v5M12 16.5h.01" />
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

/**
 * The persistent lookup-status badge — the wizard's signature moment. While the property lookup
 * runs it shows a scanning shimmer ("Checking your property…"); on success it settles into a
 * "Property found" state with a peek of the fetched data. Offers Retry on `failed` (spec §7).
 */
export function LookupBadge({ lookup, busy, onRetry }: LookupBadgeProps) {
  const { cls, label, meta } = STATUS[lookup.status];
  // On success show the data peek; otherwise the status's static meta. No transient per-attempt
  // text — it lives in a live region and would re-announce on every poll.
  const metaText = lookup.status === 'completed' ? peek(lookup.result) || meta : meta;

  return (
    <div className={`badge ${cls}`.trim()}>
      <span className="badge__glyph" aria-hidden="true">
        <Glyph status={lookup.status} />
      </span>
      {/* Live region scoped to the status text only — not the Retry button. */}
      <span className="badge__text" role="status" aria-live="polite">
        <span className="badge__label">{label}</span>
        {metaText && <span className="badge__meta">{metaText}</span>}
      </span>
      <span className="badge__spacer" />
      {lookup.status === 'failed' && (
        <button type="button" className="btn btn--ghost" onClick={onRetry} disabled={busy}>
          Retry
        </button>
      )}
    </div>
  );
}
