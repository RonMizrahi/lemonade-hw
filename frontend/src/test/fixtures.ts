import type { Question, SessionState } from '../api/types';

/**
 * Builds a {@link SessionState} for tests, with sensible defaults that callers override per case.
 * Ids are randomized so tests stay isolated (testing-standards: no hardcoded ids).
 * @param overrides partial fields to override the defaults
 * @returns a full session state
 */
export function makeSessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: crypto.randomUUID(),
    status: 'in_progress',
    version: 1,
    currentQuestion: { id: 'full_name', type: 'text' },
    answeredQuestions: [],
    externalLookup: { status: 'not_started', attempts: 0, result: null },
    completion: { canComplete: false, missingRequired: ['full_name'] },
    summary: null,
    ...overrides,
  };
}

/**
 * Convenience question builder.
 * @param id the question id
 * @param type the question type
 * @param choices optional choice list
 * @returns a question descriptor
 */
export function makeQuestion(
  id: string,
  type: Question['type'],
  choices?: string[],
): Question {
  return choices ? { id, type, choices } : { id, type };
}
