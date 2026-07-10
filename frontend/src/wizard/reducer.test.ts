import { describe, expect, it } from 'vitest';
import { makeSessionState } from '../test/fixtures';
import {
  activeQuestionId,
  initialWizardState,
  wizardReducer,
  type WizardState,
} from './reducer';

describe('wizardReducer', () => {
  it('starts idle with no session', () => {
    expect(initialWizardState.phase).toBe('idle');
    expect(initialWizardState.session).toBeNull();
  });

  it('REQUEST_START sets busy and clears the error', () => {
    const start: WizardState = { ...initialWizardState, error: 'boom' };
    const next = wizardReducer(start, { type: 'REQUEST_START' });
    expect(next.busy).toBe(true);
    expect(next.error).toBeNull();
  });

  it('REQUEST_FAILED records the error and clears busy', () => {
    const busy: WizardState = { ...initialWizardState, busy: true };
    const next = wizardReducer(busy, { type: 'REQUEST_FAILED', error: 'stale version' });
    expect(next.busy).toBe(false);
    expect(next.error).toBe('stale version');
  });

  it('SESSION_UPDATED moves to active for an in_progress session and clears edit/busy/error', () => {
    const dirty: WizardState = {
      ...initialWizardState,
      busy: true,
      error: 'x',
      editingQuestionId: 'full_name',
    };
    const session = makeSessionState({ status: 'in_progress' });
    const next = wizardReducer(dirty, { type: 'SESSION_UPDATED', session });
    expect(next.phase).toBe('active');
    expect(next.session).toBe(session);
    expect(next.busy).toBe(false);
    expect(next.error).toBeNull();
    expect(next.editingQuestionId).toBeNull();
  });

  it('SESSION_UPDATED moves to done for a completed session', () => {
    const session = makeSessionState({ status: 'completed', summary: { full_name: 'Ada' } });
    const next = wizardReducer(initialWizardState, { type: 'SESSION_UPDATED', session });
    expect(next.phase).toBe('done');
  });

  it('EDIT_ANSWER sets the editing question and clears the error', () => {
    const withErr: WizardState = { ...initialWizardState, error: 'nope' };
    const next = wizardReducer(withErr, { type: 'EDIT_ANSWER', questionId: 'residence_type' });
    expect(next.editingQuestionId).toBe('residence_type');
    expect(next.error).toBeNull();
  });

  it('CANCEL_EDIT clears the editing question', () => {
    const editing: WizardState = { ...initialWizardState, editingQuestionId: 'residence_type' };
    const next = wizardReducer(editing, { type: 'CANCEL_EDIT' });
    expect(next.editingQuestionId).toBeNull();
  });

  it('LOOKUP_POLLED reconciles lookup/version/completion WITHOUT touching the current question or edit', () => {
    const base = makeSessionState({
      version: 3,
      currentQuestion: { id: 'year_built', type: 'number' },
      answeredQuestions: [{ questionId: 'full_name', value: 'Ada', status: 'active' }],
      externalLookup: { status: 'loading', attempts: 1, result: null },
      completion: { canComplete: false, missingRequired: ['year_built'] },
    });
    const editing: WizardState = {
      ...initialWizardState,
      phase: 'active',
      session: base,
      editingQuestionId: 'full_name',
    };

    // A poll lands while the customer is editing: lookup completed, version bumped, flow advanced.
    const polled = makeSessionState({
      version: 4,
      currentQuestion: { id: 'coverage_start_date', type: 'date' }, // must be ignored
      answeredQuestions: [], // must be ignored
      externalLookup: { status: 'completed', attempts: 1, result: { estimatedValue: 1 } },
      completion: { canComplete: false, missingRequired: ['year_built'] },
    });

    const next = wizardReducer(editing, { type: 'LOOKUP_POLLED', session: polled });

    // Lookup + version + completion reconciled...
    expect(next.session?.externalLookup.status).toBe('completed');
    expect(next.session?.version).toBe(4);
    // ...but the current question, answers, and edit mode are untouched (no clobber).
    expect(next.session?.currentQuestion?.id).toBe('year_built');
    expect(next.session?.answeredQuestions).toEqual(base.answeredQuestions);
    expect(next.editingQuestionId).toBe('full_name');
  });

  it('LOOKUP_POLLED is a no-op before a session exists', () => {
    const polled = makeSessionState();
    const next = wizardReducer(initialWizardState, { type: 'LOOKUP_POLLED', session: polled });
    expect(next.session).toBeNull();
  });
});

describe('activeQuestionId', () => {
  it('returns the edited question when editing, over the current question', () => {
    const state: WizardState = {
      ...initialWizardState,
      editingQuestionId: 'residence_type',
      session: makeSessionState({ currentQuestion: { id: 'year_built', type: 'number' } }),
    };
    expect(activeQuestionId(state)).toBe('residence_type');
  });

  it('returns the current question id when not editing', () => {
    const state: WizardState = {
      ...initialWizardState,
      session: makeSessionState({ currentQuestion: { id: 'year_built', type: 'number' } }),
    };
    expect(activeQuestionId(state)).toBe('year_built');
  });

  it('returns null when there is no current question and no edit', () => {
    const state: WizardState = {
      ...initialWizardState,
      session: makeSessionState({ currentQuestion: null }),
    };
    expect(activeQuestionId(state)).toBeNull();
  });
});
