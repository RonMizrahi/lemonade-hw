/**
 * Frontend mirror of the backend's frozen contract (backend spec §6). Kept in lockstep with
 * `backend/src/onboarding/contract`. M7 builds the wizard UI on top of these types.
 */

/** Session lifecycle status. */
export type SessionStatus = 'in_progress' | 'completed';

/** Whether a stored answer is active or superseded by a branch change. */
export type AnswerStatus = 'active' | 'irrelevant';

/** External property-lookup status (four required UI states + permanent failure). */
export type ExternalLookupStatus =
  | 'not_started'
  | 'loading'
  | 'completed'
  | 'failed'
  | 'permanently_failed';

/** Supported question value types. */
export type QuestionType = 'text' | 'number' | 'boolean' | 'date' | 'choice' | 'address';

/** A single question presented to the customer. */
export interface Question {
  id: string;
  type: QuestionType;
  choices?: string[];
}

/** One answered question in the session state. */
export interface AnsweredQuestion {
  questionId: string;
  value: unknown;
  status: AnswerStatus;
}

/** The external-lookup projection for polling. */
export interface ExternalLookupState {
  status: ExternalLookupStatus;
  attempts: number;
  result: Record<string, unknown> | null;
}

/** Completion readiness. */
export interface CompletionState {
  canComplete: boolean;
  missingRequired: string[];
}

/** The full session state returned by GET and every write. */
export interface SessionState {
  sessionId: string;
  status: SessionStatus;
  version: number;
  currentQuestion: Question | null;
  answeredQuestions: AnsweredQuestion[];
  externalLookup: ExternalLookupState;
  completion: CompletionState;
  summary: Record<string, unknown> | null;
}

/** Body for submitting an answer. */
export interface SubmitAnswerBody {
  questionId: string;
  value: unknown;
  expectedVersion: number;
}

/** Body for editing a prior answer. */
export interface EditAnswerBody {
  value: unknown;
  expectedVersion: number;
}

/** Body for completing a session. */
export interface CompleteBody {
  expectedVersion: number;
}

/** The uniform error envelope returned by the API's global exception filter. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}
