import { choiceLabel, isChoiceValue, questionLabel } from '../wizard/labels';

interface SummaryViewProps {
  summary: Record<string, unknown>;
}

/**
 * Renders a submitted value into a readable string. Objects (e.g. address, property data) are
 * flattened to `key: value` pairs; booleans become Yes/No; known choice values are labelled.
 * @param value the value to render
 * @returns a display string
 */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'string') {
    // Only label known choice values; free text (names, dates, addresses) renders verbatim.
    return isChoiceValue(value) ? choiceLabel(value) : value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(renderValue).join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${questionLabel(k)}: ${renderValue(v)}`)
      .join(', ');
  }
  return String(value);
}

/**
 * The completed-session summary view. The backend returns a normalized `summary` object
 * (spec §9) keyed by field; this renders each top-level entry as a labelled row without
 * assuming a fixed shape, so it stays robust to summary changes.
 */
export function SummaryView({ summary }: SummaryViewProps) {
  const entries = Object.entries(summary);

  return (
    <section aria-label="summary">
      <h2>You're all set</h2>
      <p>Your onboarding is complete. Here's a summary of your answers:</p>
      {entries.length === 0 ? (
        <p>No summary details available.</p>
      ) : (
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.5rem 1rem' }}>
          {entries.map(([key, value]) => (
            <div key={key} style={{ display: 'contents' }}>
              <dt style={{ fontWeight: 600 }}>{questionLabel(key)}</dt>
              <dd style={{ margin: 0 }}>{renderValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
