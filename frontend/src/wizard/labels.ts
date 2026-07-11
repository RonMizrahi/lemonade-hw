/**
 * Presentation labels for the onboarding flow. The backend contract exposes only question
 * ids and types (spec §6), so the UI supplies the human-readable prompts and choice labels.
 * Unknown ids fall back to a de-slugified version of the id, so the wizard never breaks if the
 * flow definition adds a question before this map is updated.
 */

/** Prompt text keyed by questionId (spec §3). */
const QUESTION_PROMPTS: Record<string, string> = {
  full_name: 'What is your full name?',
  date_of_birth: 'What is your date of birth?',
  residence_type: 'Do you own or rent your residence?',
  property_address: 'What is the property address?',
  year_built: 'What year was the property built?',
  construction_type: 'What is the construction type?',
  has_security_system: 'Does the property have a security system?',
  security_system_monitored: 'Is the security system professionally monitored?',
  monthly_rent: 'What is your monthly rent?',
  landlord_has_insurance: 'Does your landlord have insurance?',
  num_roommates: 'How many roommates do you have?',
  coverage_start_date: 'When should coverage start?',
  wants_earthquake_coverage: 'Do you want earthquake coverage?',
};

/** Choice-value display labels (spec §3). */
const CHOICE_LABELS: Record<string, string> = {
  own: 'Own',
  rent: 'Rent',
  wood: 'Wood',
  brick: 'Brick',
  concrete: 'Concrete',
};

/**
 * De-slugifies an id into Title Case as a readable fallback. Handles both snake_case
 * (`year_built` → `Year Built`) and camelCase (`propertyData` → `Property Data`), so summary
 * keys returned by the backend read naturally too.
 * @param id the raw identifier
 * @returns a Title-Cased label
 */
function humanize(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Returns the prompt for a question id, falling back to a humanized id.
 * @param questionId the question id
 * @returns the prompt text
 */
export function questionPrompt(questionId: string): string {
  return QUESTION_PROMPTS[questionId] ?? `${humanize(questionId)}?`;
}

/**
 * Returns a display label for a question id (used in the answer list / summary).
 * @param questionId the question id
 * @returns the field label
 */
export function questionLabel(questionId: string): string {
  return humanize(questionId);
}

/**
 * Returns a display label for a choice value, falling back to a humanized value.
 * @param value the raw choice value
 * @returns the choice label
 */
export function choiceLabel(value: string): string {
  return CHOICE_LABELS[value] ?? humanize(value);
}

/**
 * Whether a string is a known choice value (so it should be labelled). Free-text answers are not
 * choice values and must be rendered verbatim, not humanized.
 * @param value the string value
 * @returns true if the value is a known choice
 */
export function isChoiceValue(value: string): boolean {
  return value in CHOICE_LABELS;
}

/** Natural display order for address parts (Postgres jsonb doesn't preserve key order). */
const ADDRESS_ORDER = ['street', 'city', 'state', 'postalCode'];

/**
 * Entries of an object in a sensible display order: known address parts first (street → city →
 * state → postal), then any remaining keys as-is. Keeps rendered addresses readable regardless of
 * the order the store returns object keys in.
 * @param obj the object to order
 * @returns `[key, value]` pairs in display order
 */
export function orderedEntries(obj: Record<string, unknown>): [string, unknown][] {
  const keys = Object.keys(obj);
  if (!keys.some((k) => ADDRESS_ORDER.includes(k))) {
    return Object.entries(obj);
  }
  const known = ADDRESS_ORDER.filter((k) => k in obj);
  const rest = keys.filter((k) => !ADDRESS_ORDER.includes(k));
  return [...known, ...rest].map((k) => [k, obj[k]] as [string, unknown]);
}
