import type { Question, QuestionType } from '../api/types';

/**
 * UI-side mirror of the flow's question descriptors (spec §3): each question's `type` and, for
 * `choice` questions, its `choices`. The backend is the source of truth for the *current*
 * question, but when the customer edits a *prior* answer whose id differs from the server's
 * current question, the contract doesn't re-describe it — so the wizard needs this map to render
 * the correct input control (a `choice` as a select, a `boolean` as radios, an `address` as
 * fields) rather than a plain text box.
 *
 * Kept minimal and in declaration order (presentation order). If the backend flow adds a
 * question before this map is updated, {@link questionDescriptor} falls back to a text input,
 * which the backend re-validates.
 */
const FLOW_QUESTIONS: Record<string, { type: QuestionType; choices?: string[] }> = {
  full_name: { type: 'text' },
  date_of_birth: { type: 'date' },
  residence_type: { type: 'choice', choices: ['own', 'rent'] },
  property_address: { type: 'address' },
  year_built: { type: 'number' },
  construction_type: { type: 'choice', choices: ['wood', 'brick', 'concrete'] },
  has_security_system: { type: 'boolean' },
  security_system_monitored: { type: 'boolean' },
  monthly_rent: { type: 'number' },
  landlord_has_insurance: { type: 'boolean' },
  num_roommates: { type: 'number' },
  coverage_start_date: { type: 'date' },
  wants_earthquake_coverage: { type: 'boolean' },
};

/**
 * Returns the {@link Question} descriptor for a question id from the static flow map, so an
 * edited (non-current) question renders its correct input control. Falls back to a text input
 * for an unknown id.
 * @param questionId the question id
 * @returns the question descriptor
 */
export function questionDescriptor(questionId: string): Question {
  const def = FLOW_QUESTIONS[questionId];
  if (!def) {
    return { id: questionId, type: 'text' };
  }
  return def.choices
    ? { id: questionId, type: def.type, choices: def.choices }
    : { id: questionId, type: def.type };
}
