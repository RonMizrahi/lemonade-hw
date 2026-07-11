import type { AnsweredQuestion } from '../api/types';
import { choiceLabel, isChoiceValue, orderedEntries, questionLabel } from '../wizard/labels';

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
    return orderedEntries(value as Record<string, unknown>)
      .map(([, v]) => v)
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
    <section className="answers" aria-label="answered-questions">
      <h3 className="answers__title">Your answers</h3>
      <ul className="answers__list">
        {active.map((answer) => {
          const editing = editingQuestionId === answer.questionId;
          return (
            <li
              key={answer.questionId}
              className={`answers__item${editing ? ' answers__item--editing' : ''}`}
            >
              <span className="answers__label">{questionLabel(answer.questionId)}</span>
              <span className="answers__value">{displayValue(answer.value)}</span>
              <button
                type="button"
                className="btn btn--link"
                aria-label={`Edit ${questionLabel(answer.questionId)}`}
                disabled={disabled || editing}
                onClick={() => onEdit(answer.questionId)}
              >
                Edit
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
