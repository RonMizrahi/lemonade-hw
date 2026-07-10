import type { AnsweredQuestion } from '../api/types';
import { choiceLabel, isChoiceValue, questionLabel } from '../wizard/labels';

interface AnswerListProps {
  answers: AnsweredQuestion[];
  /** The question currently being edited, so its row can be highlighted / its button hidden. */
  editingQuestionId: string | null;
  disabled?: boolean;
  onEdit: (questionId: string) => void;
}

/**
 * Renders a compact string for an answered value (mirrors the summary formatting but terser).
 * @param value the stored value
 * @returns a display string
 */
function displayValue(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'string') {
    // Label known choice values (own → Own); render free text verbatim.
    return isChoiceValue(value) ? choiceLabel(value) : value;
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .filter((v) => v !== '' && v !== null && v !== undefined)
      .join(', ');
  }
  return String(value ?? '—');
}

/**
 * The list of already-answered questions with a per-row Edit button — the "Back/Edit to revisit
 * answers" affordance (spec §11). Only `active` answers are shown; answers marked `irrelevant`
 * by a branch switch are hidden, matching the backend's active-answer set.
 */
export function AnswerList({ answers, editingQuestionId, disabled, onEdit }: AnswerListProps) {
  const active = answers.filter((a) => a.status === 'active');
  if (active.length === 0) {
    return null;
  }

  return (
    <section aria-label="answered-questions" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: '#6b7280' }}>
        Your answers
      </h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
        {active.map((answer) => (
          <li
            key={answer.questionId}
            style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}
          >
            <span>
              <strong>{questionLabel(answer.questionId)}:</strong> {displayValue(answer.value)}
            </span>
            <button
              type="button"
              disabled={disabled || editingQuestionId === answer.questionId}
              onClick={() => onEdit(answer.questionId)}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
