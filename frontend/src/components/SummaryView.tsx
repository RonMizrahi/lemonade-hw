import { choiceLabel, isChoiceValue, orderedEntries, questionLabel } from '../wizard/labels';

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
    return orderedEntries(value as Record<string, unknown>)
      .map(([k, v]) => `${questionLabel(k)}: ${renderValue(v)}`)
      .join(', ');
  }
  return String(value);
}

/**
 * The completed-session "cover note": the backend returns a normalized `summary` object
 * (spec §9) keyed by field; this renders each top-level entry as a receipt row without assuming
 * a fixed shape, so it stays robust to summary changes.
 */
export function SummaryView({ summary }: SummaryViewProps) {
  const entries = Object.entries(summary);

  return (
    <section className="cover" aria-label="summary">
      <div className="cover__card">
        <div className="cover__head">
          <span className="cover__seal">Cover note</span>
          <h2 className="cover__title">You're all set</h2>
          <p className="cover__sub">Here's everything we put on file for your cover.</p>
        </div>
        <div className="cover__body">
          {entries.length === 0 ? (
            <p>No summary details available.</p>
          ) : (
            <dl className="cover__grid">
              {entries.map(([key, value]) => (
                <div key={key} className="cover__row">
                  <dt className="cover__dt">{questionLabel(key)}</dt>
                  <dd className="cover__dd">{renderValue(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </section>
  );
}
