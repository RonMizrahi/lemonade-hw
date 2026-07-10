import { randomUUID } from 'crypto';
import { QuestionType } from '../common/enums';
import { FLOW_DEFINITION } from './flow-definition';
import { FlowEngineService } from './flow-engine.service';
import { AnswerMap, FlowDefinition } from './flow.types';

/** A valid, well-formed address answer for the `property_address` question. */
const VALID_ADDRESS = { street: '1 Main St', city: 'Springfield' };

/** Formats a Date as the local `YYYY-MM-DD` string the frontend submits for date answers. */
function toYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Answers common to both branches, up to (and excluding) the branch-specific questions. */
function baseAnswers(): AnswerMap {
  return {
    full_name: 'Ada Lovelace',
    date_of_birth: '1990-01-01',
    property_address: VALID_ADDRESS,
  };
}

/** All questions a homeowner must answer to reach completion. */
function completeOwnerAnswers(): AnswerMap {
  return {
    ...baseAnswers(),
    residence_type: 'own',
    year_built: 1998,
    construction_type: 'brick',
    has_security_system: true,
    security_system_monitored: true,
    coverage_start_date: '2999-01-01',
    wants_earthquake_coverage: false,
  };
}

/** All questions a renter must answer to reach completion. */
function completeRenterAnswers(): AnswerMap {
  return {
    ...baseAnswers(),
    residence_type: 'rent',
    monthly_rent: 2400,
    landlord_has_insurance: true,
    num_roommates: 1,
    coverage_start_date: '2999-01-01',
    wants_earthquake_coverage: true,
  };
}

describe('FlowEngineService', () => {
  let engine: FlowEngineService;

  beforeEach(() => {
    engine = new FlowEngineService();
  });

  describe('visibleQuestions — own vs rent branching', () => {
    it('shows only always-visible questions before the branch is chosen', () => {
      const ids = engine.visibleQuestions(FLOW_DEFINITION, {}).map((q) => q.id);

      expect(ids).toEqual([
        'full_name',
        'date_of_birth',
        'residence_type',
        'property_address',
        'coverage_start_date',
        'wants_earthquake_coverage',
      ]);
    });

    it('reveals the owner branch and hides the renter branch when residence_type == own', () => {
      const ids = engine
        .visibleQuestions(FLOW_DEFINITION, { residence_type: 'own' })
        .map((q) => q.id);

      expect(ids).toContain('year_built');
      expect(ids).toContain('construction_type');
      expect(ids).toContain('has_security_system');
      expect(ids).not.toContain('monthly_rent');
      expect(ids).not.toContain('landlord_has_insurance');
      expect(ids).not.toContain('num_roommates');
    });

    it('reveals the renter branch and hides the owner branch when residence_type == rent', () => {
      const ids = engine
        .visibleQuestions(FLOW_DEFINITION, { residence_type: 'rent' })
        .map((q) => q.id);

      expect(ids).toContain('monthly_rent');
      expect(ids).toContain('landlord_has_insurance');
      expect(ids).toContain('num_roommates');
      expect(ids).not.toContain('year_built');
      expect(ids).not.toContain('has_security_system');
    });
  });

  describe('visibleQuestions — nested security → monitored branch', () => {
    it('hides security_system_monitored until has_security_system is true', () => {
      const ids = engine
        .visibleQuestions(FLOW_DEFINITION, { residence_type: 'own', has_security_system: false })
        .map((q) => q.id);

      expect(ids).not.toContain('security_system_monitored');
    });

    it('shows security_system_monitored only for an owner with a security system', () => {
      const ownerWith = engine
        .visibleQuestions(FLOW_DEFINITION, { residence_type: 'own', has_security_system: true })
        .map((q) => q.id);
      expect(ownerWith).toContain('security_system_monitored');
    });

    it('keeps security_system_monitored hidden for a renter even if has_security_system is true', () => {
      const ids = engine
        .visibleQuestions(FLOW_DEFINITION, { residence_type: 'rent', has_security_system: true })
        .map((q) => q.id);

      expect(ids).not.toContain('security_system_monitored');
    });
  });

  describe('currentQuestion — presentation-order selection', () => {
    it('returns the first always-visible question on an empty session', () => {
      expect(engine.currentQuestion(FLOW_DEFINITION, {})?.id).toBe('full_name');
    });

    it('advances to the next visible & unanswered question in declaration order', () => {
      const answers: AnswerMap = { full_name: 'Ada', date_of_birth: '1990-01-01' };
      expect(engine.currentQuestion(FLOW_DEFINITION, answers)?.id).toBe('residence_type');
    });

    it('selects a newly revealed branch question after the branch is chosen', () => {
      const answers: AnswerMap = {
        full_name: 'Ada',
        date_of_birth: '1990-01-01',
        residence_type: 'own',
        property_address: VALID_ADDRESS,
      };
      expect(engine.currentQuestion(FLOW_DEFINITION, answers)?.id).toBe('year_built');
    });

    it('returns null once every visible question is answered (owner branch)', () => {
      expect(engine.currentQuestion(FLOW_DEFINITION, completeOwnerAnswers())).toBeNull();
    });

    it('returns null once every visible question is answered (renter branch)', () => {
      expect(engine.currentQuestion(FLOW_DEFINITION, completeRenterAnswers())).toBeNull();
    });
  });

  describe('validateAnswer — type checks', () => {
    it('rejects an unknown question id', () => {
      const result = engine.validateAnswer(FLOW_DEFINITION, `q-${randomUUID()}`, 'x', {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown question');
    });

    it('rejects an answer to a currently hidden question', () => {
      const result = engine.validateAnswer(FLOW_DEFINITION, 'monthly_rent', 1000, {
        residence_type: 'own',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not currently visible');
    });

    it('accepts a valid text answer and rejects an empty one', () => {
      expect(engine.validateAnswer(FLOW_DEFINITION, 'full_name', 'Ada', {}).valid).toBe(true);
      expect(engine.validateAnswer(FLOW_DEFINITION, 'full_name', '   ', {}).valid).toBe(false);
    });

    it('accepts a finite number and rejects non-numbers for a number question', () => {
      const answers: AnswerMap = { residence_type: 'own' };
      expect(engine.validateAnswer(FLOW_DEFINITION, 'year_built', 1998, answers).valid).toBe(true);
      expect(engine.validateAnswer(FLOW_DEFINITION, 'year_built', '1998', answers).valid).toBe(
        false,
      );
      expect(engine.validateAnswer(FLOW_DEFINITION, 'year_built', Number.NaN, answers).valid).toBe(
        false,
      );
    });

    it('accepts a boolean and rejects non-booleans for a boolean question', () => {
      expect(
        engine.validateAnswer(FLOW_DEFINITION, 'wants_earthquake_coverage', true, {}).valid,
      ).toBe(true);
      expect(
        engine.validateAnswer(FLOW_DEFINITION, 'wants_earthquake_coverage', 'yes', {}).valid,
      ).toBe(false);
    });

    it('accepts a declared choice and rejects an undeclared one', () => {
      expect(engine.validateAnswer(FLOW_DEFINITION, 'residence_type', 'own', {}).valid).toBe(true);
      expect(engine.validateAnswer(FLOW_DEFINITION, 'residence_type', 'lease', {}).valid).toBe(
        false,
      );
    });

    it('accepts a well-formed address and rejects a malformed one', () => {
      expect(
        engine.validateAnswer(FLOW_DEFINITION, 'property_address', VALID_ADDRESS, {}).valid,
      ).toBe(true);
      expect(
        engine.validateAnswer(FLOW_DEFINITION, 'property_address', { street: '1 Main St' }, {})
          .valid,
      ).toBe(false);
      expect(engine.validateAnswer(FLOW_DEFINITION, 'property_address', 'a string', {}).valid).toBe(
        false,
      );
    });

    it('rejects a malformed date string', () => {
      expect(engine.validateAnswer(FLOW_DEFINITION, 'date_of_birth', 'not-a-date', {}).valid).toBe(
        false,
      );
    });

    it('accepts a plain YYYY-MM-DD date and rejects a full ISO timestamp', () => {
      expect(engine.validateAnswer(FLOW_DEFINITION, 'date_of_birth', '1990-01-01', {}).valid).toBe(
        true,
      );
      expect(
        engine.validateAnswer(FLOW_DEFINITION, 'date_of_birth', '1990-01-01T00:00:00.000Z', {})
          .valid,
      ).toBe(false);
    });

    it('rejects an overflowing calendar date (month 13, day 32)', () => {
      expect(engine.validateAnswer(FLOW_DEFINITION, 'date_of_birth', '1990-13-01', {}).valid).toBe(
        false,
      );
      expect(engine.validateAnswer(FLOW_DEFINITION, 'date_of_birth', '1990-02-31', {}).valid).toBe(
        false,
      );
    });
  });

  describe('validateAnswer — business rules', () => {
    it('rejects a date_of_birth under 18 and accepts one at/over 18', () => {
      const under = new Date();
      under.setFullYear(under.getFullYear() - 10);
      const over = new Date();
      over.setFullYear(over.getFullYear() - 40);

      const underResult = engine.validateAnswer(FLOW_DEFINITION, 'date_of_birth', toYmd(under), {});
      expect(underResult.valid).toBe(false);
      expect(underResult.error).toContain('18');

      expect(engine.validateAnswer(FLOW_DEFINITION, 'date_of_birth', toYmd(over), {}).valid).toBe(
        true,
      );
    });

    it('rejects a coverage_start_date in the past and accepts today/future', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const nextYear = new Date();
      nextYear.setFullYear(nextYear.getFullYear() + 1);

      const pastResult = engine.validateAnswer(
        FLOW_DEFINITION,
        'coverage_start_date',
        toYmd(yesterday),
        {},
      );
      expect(pastResult.valid).toBe(false);
      expect(pastResult.error).toContain('past');

      expect(
        engine.validateAnswer(FLOW_DEFINITION, 'coverage_start_date', toYmd(nextYear), {}).valid,
      ).toBe(true);
      expect(
        engine.validateAnswer(FLOW_DEFINITION, 'coverage_start_date', toYmd(new Date()), {}).valid,
      ).toBe(true);
    });
  });

  describe('reconcile — irrelevant marking on branch switch', () => {
    it('marks renter answers irrelevant after switching residence_type to own', () => {
      const answers: AnswerMap = {
        ...baseAnswers(),
        residence_type: 'own', // edited from rent → own
        monthly_rent: 2400,
        landlord_has_insurance: true,
        num_roommates: 2,
      };
      const irrelevant = engine.reconcile(FLOW_DEFINITION, answers);

      expect(irrelevant).toEqual(
        expect.arrayContaining(['monthly_rent', 'landlord_has_insurance', 'num_roommates']),
      );
      expect(irrelevant).not.toContain('full_name');
      expect(irrelevant).not.toContain('residence_type');
    });

    it('marks security_system_monitored irrelevant when has_security_system flips to false', () => {
      const answers: AnswerMap = {
        ...baseAnswers(),
        residence_type: 'own',
        has_security_system: false, // edited from true → false
        security_system_monitored: true,
      };
      expect(engine.reconcile(FLOW_DEFINITION, answers)).toContain('security_system_monitored');
    });

    it('returns no irrelevant answers for a consistent answer set', () => {
      expect(engine.reconcile(FLOW_DEFINITION, completeOwnerAnswers())).toEqual([]);
    });
  });

  describe('completionChecklist — required visible unanswered', () => {
    it('lists all required always-visible questions on an empty session', () => {
      expect(engine.completionChecklist(FLOW_DEFINITION, {})).toEqual([
        'full_name',
        'date_of_birth',
        'residence_type',
        'property_address',
        'coverage_start_date',
        'wants_earthquake_coverage',
      ]);
    });

    it('includes owner-branch questions once residence_type == own', () => {
      const missing = engine.completionChecklist(FLOW_DEFINITION, { residence_type: 'own' });
      expect(missing).toContain('year_built');
      expect(missing).toContain('has_security_system');
      expect(missing).not.toContain('monthly_rent');
    });

    it('is empty when every required visible question is answered (owner)', () => {
      expect(engine.completionChecklist(FLOW_DEFINITION, completeOwnerAnswers())).toEqual([]);
    });

    it('is empty when every required visible question is answered (renter)', () => {
      expect(engine.completionChecklist(FLOW_DEFINITION, completeRenterAnswers())).toEqual([]);
    });

    it('does not require the nested monitored question when there is no security system', () => {
      const answers: AnswerMap = {
        ...completeOwnerAnswers(),
        has_security_system: false,
      };
      delete answers.security_system_monitored;
      expect(engine.completionChecklist(FLOW_DEFINITION, answers)).toEqual([]);
    });
  });

  describe('purity — engine does not mutate inputs', () => {
    it('leaves the answer map untouched across all operations', () => {
      const answers = completeOwnerAnswers();
      const snapshot = JSON.stringify(answers);

      engine.visibleQuestions(FLOW_DEFINITION, answers);
      engine.currentQuestion(FLOW_DEFINITION, answers);
      engine.reconcile(FLOW_DEFINITION, answers);
      engine.completionChecklist(FLOW_DEFINITION, answers);
      engine.validateAnswer(FLOW_DEFINITION, 'full_name', 'x', answers);

      expect(JSON.stringify(answers)).toBe(snapshot);
    });
  });

  it('uses a well-formed flow definition (sanity: 13 questions)', () => {
    const flow: FlowDefinition = FLOW_DEFINITION;
    expect(flow.questions).toHaveLength(13);
    expect(flow.questions.map((q) => q.type)).toContain(QuestionType.Address);
  });
});
