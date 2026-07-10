import type { SessionState } from '../api/types';

/**
 * The wizard's top-level phase.
 * - `idle`   — before Start is pressed (or after a fatal error resets it).
 * - `active` — a session exists and the customer is answering / reviewing.
 * - `done`   — the session is completed; the summary view is shown.
 */
export type WizardPhase = 'idle' | 'active' | 'done';

/**
 * The wizard UI state. `session` is the source of truth returned by every API call; the reducer
 * layers the UI-only concerns (which question is being edited, an in-flight flag, the last error)
 * on top of it. This is deliberately a pure reducer so the flow is unit-testable in isolation
 * from the network.
 */
export interface WizardState {
  phase: WizardPhase;
  /** Latest full session state from the server, or null before Start. */
  session: SessionState | null;
  /** When set, the customer is editing this already-answered question (not the current one). */
  editingQuestionId: string | null;
  /** True while an API request is in flight — used to disable inputs / show progress. */
  busy: boolean;
  /** The last user-facing error message, or null. */
  error: string | null;
}

/** The initial (pre-Start) state. */
export const initialWizardState: WizardState = {
  phase: 'idle',
  session: null,
  editingQuestionId: null,
  busy: false,
  error: null,
};

/**
 * Wizard actions. Kept minimal: a request lifecycle (`REQUEST_START` → `SESSION_UPDATED` |
 * `REQUEST_FAILED`), plus the edit-mode toggles.
 */
export type WizardAction =
  | { type: 'REQUEST_START' }
  | { type: 'REQUEST_FAILED'; error: string }
  | { type: 'SESSION_UPDATED'; session: SessionState }
  | { type: 'LOOKUP_POLLED'; session: SessionState }
  | { type: 'EDIT_ANSWER'; questionId: string }
  | { type: 'CANCEL_EDIT' };

/**
 * Derives the phase from a freshly-received session state.
 * @param session the session state
 * @returns `done` when completed, otherwise `active`
 */
function phaseForSession(session: SessionState): WizardPhase {
  return session.status === 'completed' ? 'done' : 'active';
}

/**
 * Pure wizard reducer. Every network result flows through `SESSION_UPDATED`, so the phase, edit
 * mode, and busy/error flags are always a deterministic function of the last action + state.
 * @param state the current wizard state
 * @param action the action to apply
 * @returns the next wizard state
 */
export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'REQUEST_START':
      return { ...state, busy: true, error: null };

    case 'REQUEST_FAILED':
      return { ...state, busy: false, error: action.error };

    case 'SESSION_UPDATED':
      return {
        ...state,
        phase: phaseForSession(action.session),
        session: action.session,
        // A completed write clears any in-progress edit and busy/error state.
        editingQuestionId: null,
        busy: false,
        error: null,
      };

    case 'LOOKUP_POLLED': {
      // A background poll: reconcile ONLY the lookup projection, version, and completion so a
      // lookup that reaches a terminal state is never dropped — even mid-edit. It deliberately
      // does NOT touch `currentQuestion`/`answeredQuestions`/edit/busy, so it can never clobber
      // the input the customer is currently filling.
      if (!state.session) {
        return state;
      }
      return {
        ...state,
        session: {
          ...state.session,
          version: action.session.version,
          externalLookup: action.session.externalLookup,
          completion: action.session.completion,
        },
      };
    }

    case 'EDIT_ANSWER':
      return { ...state, editingQuestionId: action.questionId, error: null };

    case 'CANCEL_EDIT':
      return { ...state, editingQuestionId: null };

    default:
      return state;
  }
}

/**
 * Selects the question the customer should answer right now: the one being edited (if any),
 * otherwise the server's `currentQuestion`. Returns null when there is nothing to answer.
 * @param state the wizard state
 * @returns the questionId to render an input for, or null
 */
export function activeQuestionId(state: WizardState): string | null {
  if (state.editingQuestionId) {
    return state.editingQuestionId;
  }
  return state.session?.currentQuestion?.id ?? null;
}
