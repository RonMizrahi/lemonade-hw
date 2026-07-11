import type { SessionState } from '../api/types';

/** The four journey stages shown in the progress rail. */
export type SectionId = 'about' | 'property' | 'coverage' | 'review';
export type StepStatus = 'done' | 'current' | 'todo';

/** Ordered rail stages. */
export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'about', label: 'About you' },
  { id: 'property', label: 'Your property' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'review', label: 'Review' },
];

/** Which stage each question belongs to (both own and rent branches map to `property`). */
const SECTION_OF: Record<string, SectionId> = {
  full_name: 'about',
  date_of_birth: 'about',
  residence_type: 'about',
  property_address: 'property',
  year_built: 'property',
  construction_type: 'property',
  has_security_system: 'property',
  security_system_monitored: 'property',
  monthly_rent: 'property',
  landlord_has_insurance: 'property',
  num_roommates: 'property',
  coverage_start_date: 'coverage',
  wants_earthquake_coverage: 'coverage',
};

/** The stage label a question belongs to (for the question-card eyebrow). */
export function sectionLabelForQuestion(questionId: string): string {
  const id = SECTION_OF[questionId];
  return SECTIONS.find((s) => s.id === id)?.label ?? '';
}

/** A rendered rail step with its completion state for this session's branch. */
export interface JourneyStep {
  id: SectionId;
  label: string;
  status: StepStatus;
  answered: number;
  total: number;
}

/**
 * Derives the progress rail from the session itself — so it adapts to the own/rent branch for
 * free. The in-scope questions for a stage are the ones the backend has surfaced: active answers
 * + the current question + the still-missing required questions. A stage is `done` when all its
 * in-scope questions are answered, `current` when it holds the current question, else `todo`.
 * The final `review` stage is `current` once every question is answered and `done` on completion.
 */
export function computeJourney(session: SessionState): JourneyStep[] {
  const currentId = session.currentQuestion?.id ?? null;
  const currentSection = currentId ? SECTION_OF[currentId] : null;

  const counts = new Map<SectionId, { answered: number; total: number }>(
    SECTIONS.map((s) => [s.id, { answered: 0, total: 0 }]),
  );
  const seen = new Set<string>();
  const tally = (questionId: string, isAnswered: boolean): void => {
    const section = SECTION_OF[questionId];
    if (!section || seen.has(questionId)) {
      return;
    }
    seen.add(questionId);
    const rec = counts.get(section);
    if (!rec) {
      return;
    }
    rec.total += 1;
    if (isAnswered) {
      rec.answered += 1;
    }
  };

  session.answeredQuestions
    .filter((a) => a.status === 'active')
    .forEach((a) => tally(a.questionId, true));
  if (currentId) {
    tally(currentId, false);
  }
  session.completion.missingRequired.forEach((q) => tally(q, false));

  const allAnswered = currentId === null;
  const completed = session.status === 'completed';

  return SECTIONS.map(({ id, label }) => {
    if (id === 'review') {
      const status: StepStatus = completed ? 'done' : allAnswered ? 'current' : 'todo';
      return { id, label, status, answered: completed ? 1 : 0, total: 1 };
    }
    const rec = counts.get(id) ?? { answered: 0, total: 0 };
    let status: StepStatus;
    if (id === currentSection) {
      status = 'current';
    } else if (rec.total > 0 && rec.answered >= rec.total) {
      status = 'done';
    } else {
      status = 'todo';
    }
    return { id, label, status, answered: rec.answered, total: rec.total };
  });
}
