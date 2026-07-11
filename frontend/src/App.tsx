import { useCallback, useMemo, useReducer } from 'react';
import { OnboardingClient } from './api/client';
import type { Question, SessionState } from './api/types';
import { AnswerList } from './components/AnswerList';
import { JourneyRail } from './components/JourneyRail';
import { LookupBadge } from './components/LookupBadge';
import { QuestionInput } from './components/QuestionInput';
import { SummaryView } from './components/SummaryView';
import { useLookupPolling } from './hooks/useLookupPolling';
import { questionDescriptor } from './wizard/flow';
import { questionLabel } from './wizard/labels';
import {
  activeQuestionId,
  initialWizardState,
  wizardReducer,
  type WizardState,
} from './wizard/reducer';

interface AppProps {
  /** Injectable for tests; defaults to the real client (same-origin, proxied in dev). */
  client?: OnboardingClient;
}

/**
 * Resolves the {@link Question} descriptor to render an input for, given the active question id.
 * Prefers the server's `currentQuestion` when the ids match (authoritative). When editing a
 * *prior* answer whose id differs, the contract doesn't re-describe it, so we fall back to the
 * static flow descriptor ({@link questionDescriptor}) — which renders the correct control
 * (select / radios / address fields) instead of a plain text box.
 */
function resolveQuestion(state: WizardState, questionId: string): Question {
  const current = state.session?.currentQuestion;
  if (current && current.id === questionId) {
    return current;
  }
  return questionDescriptor(questionId);
}

/**
 * Finds the stored value for a question (used to seed the input when editing).
 * @param state the wizard state
 * @param questionId the question id
 * @returns the stored value, or undefined
 */
function storedValue(state: WizardState, questionId: string): unknown {
  return state.session?.answeredQuestions.find((a) => a.questionId === questionId)?.value;
}

/**
 * The onboarding wizard: Start → one question at a time (input by type) → Back/Edit to revisit
 * answers → a persistent lookup-status badge that polls in the background → Retry on failure →
 * Complete (gated on `completion.canComplete`) → summary. All server writes echo `expectedVersion`
 * and the client attaches a generated `Idempotency-Key` on submit/retry (spec §6, §11).
 */
export default function App({ client: injectedClient }: AppProps = {}) {
  const client = useMemo(() => injectedClient ?? new OnboardingClient(), [injectedClient]);
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);

  /** Runs an API call through the request lifecycle, mapping the result/error into state. */
  const runWrite = useCallback(
    async (fn: () => Promise<SessionState>) => {
      dispatch({ type: 'REQUEST_START' });
      try {
        const session = await fn();
        dispatch({ type: 'SESSION_UPDATED', session });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong';
        dispatch({ type: 'REQUEST_FAILED', error: message });
      }
    },
    [],
  );

  const handleStart = useCallback(() => runWrite(() => client.startSession()), [client, runWrite]);

  const handleAnswer = useCallback(
    (questionId: string, value: unknown, isEdit: boolean) => {
      const session = state.session;
      if (!session) {
        return;
      }
      const expectedVersion = session.version;
      void runWrite(() =>
        isEdit
          ? client.editAnswer(session.sessionId, questionId, { value, expectedVersion })
          : client.submitAnswer(session.sessionId, { questionId, value, expectedVersion }),
      );
    },
    [client, runWrite, state.session],
  );

  const handleRetry = useCallback(() => {
    const session = state.session;
    if (!session) {
      return;
    }
    void runWrite(() => client.retryLookup(session.sessionId));
  }, [client, runWrite, state.session]);

  const handleComplete = useCallback(() => {
    const session = state.session;
    if (!session) {
      return;
    }
    void runWrite(() => client.complete(session.sessionId, { expectedVersion: session.version }));
  }, [client, runWrite, state.session]);

  // Background polling for the lookup badge. `LOOKUP_POLLED` reconciles only the lookup
  // projection + version + completion, so a completed lookup is reflected immediately (even while
  // the customer is editing) without ever clobbering the answer they are currently filling.
  const onPolledSession = useCallback((session: SessionState) => {
    dispatch({ type: 'LOOKUP_POLLED', session });
  }, []);

  useLookupPolling({
    client,
    sessionId: state.session?.sessionId ?? null,
    enabled: state.phase === 'active',
    lookup: state.session?.externalLookup ?? null,
    onSession: onPolledSession,
  });

  return (
    <div className="app">
      <div className="app-shell">
        <div>
          <div className="brand">
            <span className="brand__mark" aria-hidden="true" />
            <span className="brand__name">
              Cover<span>note</span>
            </span>
          </div>
          {state.session && <JourneyRail session={state.session} />}
        </div>

        <main className="stage">
          {state.error && (
            <p role="alert" className="alert">
              {state.error}
            </p>
          )}

          {state.phase === 'idle' && (
            <section className="hero">
              <p className="eyebrow">Home &amp; renters insurance</p>
              <h1 className="hero__title">Let&rsquo;s get you covered.</h1>
              <p className="hero__lede">
                A handful of quick questions &mdash; and while you answer, we&rsquo;ll pull your
                property details in the background. About a minute, no login.
              </p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleStart}
                disabled={state.busy}
              >
                Start
              </button>
              <div className="hero__meta">
                <div>
                  <b>~1 min</b>to finish
                </div>
                <div>
                  <b>Live</b>property lookup
                </div>
                <div>
                  <b>Editable</b>change any answer
                </div>
              </div>
            </section>
          )}

          {state.phase === 'active' && state.session && (
            <ActiveWizard
              state={state}
              onAnswer={handleAnswer}
              onEdit={(id) => dispatch({ type: 'EDIT_ANSWER', questionId: id })}
              onCancelEdit={() => dispatch({ type: 'CANCEL_EDIT' })}
              onRetry={handleRetry}
              onComplete={handleComplete}
            />
          )}

          {state.phase === 'done' && state.session?.summary && (
            <SummaryView summary={state.session.summary} />
          )}
        </main>
      </div>
    </div>
  );
}

interface ActiveWizardProps {
  state: WizardState;
  onAnswer: (questionId: string, value: unknown, isEdit: boolean) => void;
  onEdit: (questionId: string) => void;
  onCancelEdit: () => void;
  onRetry: () => void;
  onComplete: () => void;
}

/**
 * The active-session view: the persistent lookup badge, the current/edited question input, the
 * revisitable answer list, and the completion control. Split out so `App` stays a thin shell.
 */
function ActiveWizard({
  state,
  onAnswer,
  onEdit,
  onCancelEdit,
  onRetry,
  onComplete,
}: ActiveWizardProps) {
  const session = state.session!;
  const questionId = activeQuestionId(state);
  const isEditing = state.editingQuestionId !== null;
  const lookup = session.externalLookup;

  return (
    <>
      <LookupBadge lookup={lookup} busy={state.busy} onRetry={onRetry} />

      {questionId ? (
        <section className="card" aria-label={isEditing ? 'edit-question' : 'current-question'}>
          {isEditing && (
            <div className="editbar">
              <span>Editing a previous answer</span>
              <button
                type="button"
                className="btn btn--link"
                onClick={onCancelEdit}
                disabled={state.busy}
              >
                Cancel
              </button>
            </div>
          )}
          <QuestionInput
            key={questionId}
            question={resolveQuestion(state, questionId)}
            initialValue={isEditing ? storedValue(state, questionId) : undefined}
            disabled={state.busy}
            onSubmit={(value) => onAnswer(questionId, value, isEditing)}
          />
        </section>
      ) : (
        <section className="card">
          <p className="q__prompt">Everything&rsquo;s answered &mdash; you&rsquo;re ready to review.</p>
        </section>
      )}

      <AnswerList
        answers={session.answeredQuestions}
        editingQuestionId={state.editingQuestionId}
        disabled={state.busy}
        onEdit={onEdit}
      />

      <div className="finish">
        <button
          type="button"
          className="btn btn--primary"
          onClick={onComplete}
          disabled={!session.completion.canComplete || state.busy}
        >
          Complete
        </button>
        {!session.completion.canComplete && session.completion.missingRequired.length > 0 && (
          <p className="finish__hint">
            A few more to go: <b>{session.completion.missingRequired.map(questionLabel).join(', ')}</b>
          </p>
        )}
      </div>
    </>
  );
}
