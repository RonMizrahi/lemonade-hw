import { QuestionType } from '../common/enums';
import { AnswerMap, FlowDefinition, QuestionDef } from './flow.types';

/**
 * The candidate values each declared question can take when driving predicate probes: the
 * question's own `choices` for a choice, both booleans otherwise. Predicates branch on these,
 * so trying each drives helper functions (e.g. an `isOwner` guard) down every path — exposing
 * nested references that a single fixed answer map would leave behind a short-circuited `&&`.
 * @param questions the declared questions
 * @returns questionId → the values to try for it during probing
 */
function candidateValuesByQuestion(questions: QuestionDef[]): Map<string, unknown[]> {
  const byQuestion = new Map<string, unknown[]>();
  for (const question of questions) {
    const values =
      question.type === QuestionType.Choice && question.choices ? question.choices : [true, false];
    byQuestion.set(question.id, values);
  }
  return byQuestion;
}

/**
 * Builds the answer maps to probe predicates with: each declared question set to each of its
 * candidate values in turn (all others left absent). This is enough to flip every top-level and
 * nested branch, so every predicate path is exercised at least once.
 * @param candidates questionId → its candidate values
 * @returns the answer maps to run predicates against
 */
function probeAnswerMaps(candidates: Map<string, unknown[]>): AnswerMap[] {
  const maps: AnswerMap[] = [{}];
  for (const [questionId, values] of candidates) {
    for (const value of values) {
      maps.push({ [questionId]: value });
    }
  }
  return maps;
}

/**
 * Collects every answer-map key a predicate reads. Runs the predicate over a recording Proxy for
 * each probe answer map: the Proxy returns the underlying map's value (so real branch conditions
 * hold) while recording every key access — including keys not present in the map, which is how an
 * undeclared reference is caught.
 * @param predicate the `visibleWhen` predicate to probe
 * @param answerMaps the answer maps to drive branch coverage
 * @returns the set of answer-map keys the predicate accessed across all probes
 */
function referencedIds(
  predicate: (answers: AnswerMap) => boolean,
  answerMaps: AnswerMap[],
): Set<string> {
  const accessed = new Set<string>();
  for (const answers of answerMaps) {
    const probe = new Proxy(answers, {
      get(target, property): unknown {
        if (typeof property === 'string') {
          accessed.add(property);
          return target[property];
        }
        return undefined;
      },
      has(target, property): boolean {
        if (typeof property === 'string') {
          accessed.add(property);
        }
        return property in target;
      },
    });
    predicate(probe);
  }
  return accessed;
}

/**
 * Verifies a `choice` question declares a non-empty `choices` array.
 * @param question the question to check
 * @throws Error when a choice question is missing its choices
 */
function assertChoicesPresent(question: QuestionDef): void {
  if (question.type !== QuestionType.Choice) {
    return;
  }
  if (!question.choices || question.choices.length === 0) {
    throw new Error(`Choice question "${question.id}" must declare a non-empty choices array`);
  }
}

/**
 * Boot-time flow-definition validator (spec §4). Fails fast on a structurally invalid
 * definition so a bad flow can never reach runtime. Checks: unique question ids; `choices`
 * present for every `choice` question; every `visibleWhen` predicate references only declared
 * question ids; at least one always-visible question exists.
 * @param flow the flow definition to validate
 * @throws Error if the definition is structurally invalid
 */
export function validateFlowDefinition(flow: FlowDefinition): void {
  if (flow.questions.length === 0) {
    throw new Error('Flow definition must declare at least one question');
  }

  const declaredIds = new Set<string>();
  for (const question of flow.questions) {
    if (declaredIds.has(question.id)) {
      throw new Error(`Duplicate question id: ${question.id}`);
    }
    declaredIds.add(question.id);
  }

  const answerMaps = probeAnswerMaps(candidateValuesByQuestion(flow.questions));

  for (const question of flow.questions) {
    assertChoicesPresent(question);

    if (!question.visibleWhen) {
      continue;
    }
    for (const referenced of referencedIds(question.visibleWhen, answerMaps)) {
      if (!declaredIds.has(referenced)) {
        throw new Error(
          `Question "${question.id}" predicate references unknown question id: ${referenced}`,
        );
      }
    }
  }

  const hasAlwaysVisible = flow.questions.some((question) => !question.visibleWhen);
  if (!hasAlwaysVisible) {
    throw new Error('Flow definition must have at least one always-visible question');
  }
}
