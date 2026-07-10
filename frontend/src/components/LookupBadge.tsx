import type { ExternalLookupState, ExternalLookupStatus } from '../api/types';

/** Badge label + color per lookup status. `permanently_failed` reads as fallback-applied. */
const STATUS_DISPLAY: Record<ExternalLookupStatus, { label: string; color: string }> = {
  not_started: { label: 'Property lookup: not started', color: '#6b7280' },
  loading: { label: 'Property lookup: in progress…', color: '#b45309' },
  completed: { label: 'Property lookup: completed', color: '#15803d' },
  failed: { label: 'Property lookup: failed', color: '#b91c1c' },
  permanently_failed: {
    label: 'Property lookup: failed — fallback applied',
    color: '#b91c1c',
  },
};

interface LookupBadgeProps {
  lookup: ExternalLookupState;
  /** Whether a manual retry is currently allowed (status `failed`) and not busy. */
  canRetry: boolean;
  onRetry: () => void;
}

/**
 * The persistent lookup-status badge shown throughout the wizard. Reflects the polled status and
 * offers a Retry button when the lookup has `failed` (but not once `permanently_failed`, where a
 * fallback already unblocks completion — spec §7 UI state mapping).
 */
export function LookupBadge({ lookup, canRetry, onRetry }: LookupBadgeProps) {
  const display = STATUS_DISPLAY[lookup.status];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.5rem 0.75rem',
        borderRadius: 6,
        border: `1px solid ${display.color}`,
        color: display.color,
        fontSize: '0.9rem',
      }}
    >
      <span>{display.label}</span>
      {lookup.status === 'loading' && lookup.attempts > 0 && (
        <span style={{ opacity: 0.7 }}>attempt {lookup.attempts}</span>
      )}
      {lookup.status === 'failed' && (
        <button type="button" onClick={onRetry} disabled={!canRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
