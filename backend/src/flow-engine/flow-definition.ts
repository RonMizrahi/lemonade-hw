import { QuestionType } from '../common/enums';
import { AnswerMap, FlowDefinition } from './flow.types';

/**
 * The active flow version number. Every session pins the flow version it started under so
 * in-flight sessions stay stable even if the definition changes (spec §4).
 */
export const ACTIVE_FLOW_VERSION = 1;

/** The two residence-type branches (spec §3). */
const RESIDENCE_OWN = 'own';
const RESIDENCE_RENT = 'rent';

/** Question ids referenced by predicates — named so branch conditions read cleanly. */
const RESIDENCE_TYPE = 'residence_type';
const HAS_SECURITY_SYSTEM = 'has_security_system';

/** Minimum age (years) accepted for `date_of_birth` (spec §3, §13). */
const MIN_AGE_YEARS = 18;

/**
 * @param answers the current answer map
 * @returns true when the customer selected the homeowner branch
 */
function isOwner(answers: AnswerMap): boolean {
  return answers[RESIDENCE_TYPE] === RESIDENCE_OWN;
}

/**
 * @param answers the current answer map
 * @returns true when the customer selected the renter branch
 */
function isRenter(answers: AnswerMap): boolean {
  return answers[RESIDENCE_TYPE] === RESIDENCE_RENT;
}

/**
 * Parses a stored date answer into a local calendar date at midnight. The leading
 * `YYYY-MM-DD` is read as local calendar components (never through UTC), so the calendar day
 * is stable regardless of server timezone — a plain `new Date('YYYY-MM-DD')` would parse as
 * UTC midnight and shift back a day in negative-offset zones.
 * @param value the raw answer value
 * @returns the parsed Date, or null when not a valid `YYYY-MM-DD[...]` string
 */
function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  // Reject overflow (e.g. month 13, day 32) that Date silently rolls forward.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/**
 * @returns today's date at local midnight
 */
function todayAtMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Business rule: the customer must be at least {@link MIN_AGE_YEARS} today (spec §3).
 * @param value the raw `date_of_birth` answer
 * @returns an error string when under age, otherwise null
 */
function validateDateOfBirth(value: unknown): string | null {
  const dob = parseDateOnly(value);
  if (!dob) {
    return null; // base type check reports the malformed value
  }
  const eighteenthBirthday = new Date(
    dob.getFullYear() + MIN_AGE_YEARS,
    dob.getMonth(),
    dob.getDate(),
  );
  return eighteenthBirthday.getTime() > todayAtMidnight().getTime()
    ? `Applicant must be at least ${MIN_AGE_YEARS} years old`
    : null;
}

/**
 * Business rule: coverage cannot start in the past (spec §3).
 * @param value the raw `coverage_start_date` answer
 * @returns an error string when the date is before today, otherwise null
 */
function validateCoverageStartDate(value: unknown): string | null {
  const start = parseDateOnly(value);
  if (!start) {
    return null; // base type check reports the malformed value
  }
  return start.getTime() < todayAtMidnight().getTime()
    ? 'Coverage start date cannot be in the past'
    : null;
}

/**
 * The 13-question home/renters onboarding flow (spec §3): 6 always-visible questions, a
 * top-level own/rent branch, and a nested security-system branch. Declaration order is
 * presentation order. Predicates and per-type business rules are pure functions of the
 * answer map — the engine derives visibility, current question, and completion from them.
 */
export const FLOW_DEFINITION: FlowDefinition = {
  version: ACTIVE_FLOW_VERSION,
  questions: [
    {
      id: 'full_name',
      type: QuestionType.Text,
      required: true,
    },
    {
      id: 'date_of_birth',
      type: QuestionType.Date,
      required: true,
      validate: (value) => validateDateOfBirth(value),
    },
    {
      id: RESIDENCE_TYPE,
      type: QuestionType.Choice,
      required: true,
      choices: [RESIDENCE_OWN, RESIDENCE_RENT],
    },
    {
      id: 'property_address',
      type: QuestionType.Address,
      required: true,
    },
    {
      id: 'year_built',
      type: QuestionType.Number,
      required: true,
      visibleWhen: (answers) => isOwner(answers),
    },
    {
      id: 'construction_type',
      type: QuestionType.Choice,
      required: true,
      choices: ['wood', 'brick', 'concrete'],
      visibleWhen: (answers) => isOwner(answers),
    },
    {
      id: HAS_SECURITY_SYSTEM,
      type: QuestionType.Boolean,
      required: true,
      visibleWhen: (answers) => isOwner(answers),
    },
    {
      id: 'security_system_monitored',
      type: QuestionType.Boolean,
      required: true,
      visibleWhen: (answers) => isOwner(answers) && answers[HAS_SECURITY_SYSTEM] === true,
    },
    {
      id: 'monthly_rent',
      type: QuestionType.Number,
      required: true,
      visibleWhen: (answers) => isRenter(answers),
    },
    {
      id: 'landlord_has_insurance',
      type: QuestionType.Boolean,
      required: true,
      visibleWhen: (answers) => isRenter(answers),
    },
    {
      id: 'num_roommates',
      type: QuestionType.Number,
      required: true,
      visibleWhen: (answers) => isRenter(answers),
    },
    {
      id: 'coverage_start_date',
      type: QuestionType.Date,
      required: true,
      validate: (value) => validateCoverageStartDate(value),
    },
    {
      id: 'wants_earthquake_coverage',
      type: QuestionType.Boolean,
      required: true,
    },
  ],
};
