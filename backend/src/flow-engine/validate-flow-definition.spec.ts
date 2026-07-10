import { randomUUID } from 'crypto';
import { QuestionType } from '../common/enums';
import { FLOW_DEFINITION } from './flow-definition';
import { AnswerMap, FlowDefinition, QuestionDef } from './flow.types';
import { validateFlowDefinition } from './validate-flow-definition';

/** A minimal always-visible required text question with a random id. */
function alwaysVisibleQuestion(id: string = `q-${randomUUID()}`): QuestionDef {
  return { id, type: QuestionType.Text, required: true };
}

/** Wraps questions into a flow definition at version 1. */
function flowOf(questions: QuestionDef[]): FlowDefinition {
  return { version: 1, questions };
}

describe('validateFlowDefinition', () => {
  it('accepts the real 13-question flow definition', () => {
    expect(() => validateFlowDefinition(FLOW_DEFINITION)).not.toThrow();
  });

  it('rejects an empty flow definition', () => {
    expect(() => validateFlowDefinition(flowOf([]))).toThrow('at least one question');
  });

  it('rejects duplicate question ids', () => {
    const duplicatedId = `dup-${randomUUID()}`;
    const flow = flowOf([alwaysVisibleQuestion(duplicatedId), alwaysVisibleQuestion(duplicatedId)]);

    expect(() => validateFlowDefinition(flow)).toThrow(`Duplicate question id: ${duplicatedId}`);
  });

  it('rejects a choice question with no choices', () => {
    const id = `choice-${randomUUID()}`;
    const flow = flowOf([
      alwaysVisibleQuestion(),
      { id, type: QuestionType.Choice, required: true },
    ]);

    expect(() => validateFlowDefinition(flow)).toThrow('must declare a non-empty choices array');
  });

  it('rejects a choice question with an empty choices array', () => {
    const id = `choice-${randomUUID()}`;
    const flow = flowOf([
      alwaysVisibleQuestion(),
      { id, type: QuestionType.Choice, required: true, choices: [] },
    ]);

    expect(() => validateFlowDefinition(flow)).toThrow('must declare a non-empty choices array');
  });

  it('accepts a choice question that declares choices', () => {
    const id = `choice-${randomUUID()}`;
    const flow = flowOf([
      alwaysVisibleQuestion(),
      { id, type: QuestionType.Choice, required: true, choices: ['a', 'b'] },
    ]);

    expect(() => validateFlowDefinition(flow)).not.toThrow();
  });

  it('rejects a predicate that references an undeclared question id', () => {
    const unknownId = `ghost-${randomUUID()}`;
    const branchId = `branch-${randomUUID()}`;
    const flow = flowOf([
      alwaysVisibleQuestion(),
      {
        id: branchId,
        type: QuestionType.Text,
        required: true,
        visibleWhen: (answers: AnswerMap) => answers[unknownId] === 'x',
      },
    ]);

    expect(() => validateFlowDefinition(flow)).toThrow(unknownId);
  });

  it('accepts a predicate that references only declared question ids', () => {
    const gateId = `gate-${randomUUID()}`;
    const dependentId = `dep-${randomUUID()}`;
    const flow = flowOf([
      { ...alwaysVisibleQuestion(gateId), type: QuestionType.Boolean },
      {
        id: dependentId,
        type: QuestionType.Text,
        required: true,
        visibleWhen: (answers: AnswerMap) => answers[gateId] === true,
      },
    ]);

    expect(() => validateFlowDefinition(flow)).not.toThrow();
  });

  it('detects an undeclared id even when combined with a declared one (using `in`)', () => {
    const declaredId = `known-${randomUUID()}`;
    const unknownId = `missing-${randomUUID()}`;
    const flow = flowOf([
      alwaysVisibleQuestion(declaredId),
      {
        id: `dep-${randomUUID()}`,
        type: QuestionType.Text,
        required: true,
        visibleWhen: (answers: AnswerMap) => declaredId in answers && unknownId in answers,
      },
    ]);

    expect(() => validateFlowDefinition(flow)).toThrow(unknownId);
  });

  it('detects an undeclared id reached only through a nested branch (short-circuited &&)', () => {
    const gateId = `gate-${randomUUID()}`;
    const nestedUnknownId = `nested-${randomUUID()}`;
    const flow = flowOf([
      { ...alwaysVisibleQuestion(gateId), type: QuestionType.Choice, choices: ['own', 'rent'] },
      {
        id: `dep-${randomUUID()}`,
        type: QuestionType.Text,
        required: true,
        // The unknown reference is guarded behind the gate — the probe must flip the gate
        // to 'own' to reach it, exactly like the real nested security-system branch.
        visibleWhen: (answers: AnswerMap) =>
          answers[gateId] === 'own' && answers[nestedUnknownId] === true,
      },
    ]);

    expect(() => validateFlowDefinition(flow)).toThrow(nestedUnknownId);
  });

  it('rejects a definition with no always-visible question', () => {
    const gateId = `gate-${randomUUID()}`;
    const flow = flowOf([
      {
        id: gateId,
        type: QuestionType.Text,
        required: true,
        visibleWhen: (answers: AnswerMap) => answers[gateId] === 'x',
      },
    ]);

    expect(() => validateFlowDefinition(flow)).toThrow('at least one always-visible question');
  });
});
