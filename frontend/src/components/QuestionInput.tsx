import { useMemo, useState } from 'react';
import type { Question } from '../api/types';
import { choiceLabel, questionPrompt } from '../wizard/labels';
import { sectionLabelForQuestion } from '../wizard/sections';

/**
 * The value shape the wizard submits for an `address` question. Matches what the backend's
 * address validation expects (`street` + `city`); kept structured so it round-trips on edit.
 */
export interface AddressValue {
  street: string;
  city: string;
  state: string;
  postalCode: string;
}

const EMPTY_ADDRESS: AddressValue = { street: '', city: '', state: '', postalCode: '' };

/**
 * Coerces an unknown stored value into an {@link AddressValue} for editing an address answer.
 * @param value the stored value (from a prior answer)
 * @returns a fully-populated address draft
 */
function toAddressValue(value: unknown): AddressValue {
  if (value && typeof value === 'object') {
    const v = value as Partial<AddressValue>;
    return {
      street: v.street ?? '',
      city: v.city ?? '',
      state: v.state ?? '',
      postalCode: v.postalCode ?? '',
    };
  }
  return EMPTY_ADDRESS;
}

/**
 * Computes the initial draft string for a scalar (non-address) input from a prior value.
 * @param value the stored value
 * @returns the string to seed the input with
 */
function toScalarDraft(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

interface QuestionInputProps {
  question: Question;
  /** The previously-stored value when editing; undefined for a fresh answer. */
  initialValue?: unknown;
  /** Whether inputs are disabled (e.g. while a request is in flight). */
  disabled?: boolean;
  /** Called with the normalized value when the customer submits the input. */
  onSubmit: (value: unknown) => void;
}

/**
 * Renders the input for a single question, dispatching on `question.type`, and normalizes the
 * raw input into the value the API expects:
 * - `number`  → JS number
 * - `boolean` → true/false (segmented radios)
 * - `choice`  → the selected choice string
 * - `address` → an {@link AddressValue} object
 * - `text` / `date` → the string as typed
 *
 * A `key={question.id}` on the parent remounts this component per question, so local draft
 * state resets automatically without an effect.
 */
export function QuestionInput({ question, initialValue, disabled, onSubmit }: QuestionInputProps) {
  const [scalar, setScalar] = useState<string>(() => toScalarDraft(initialValue));
  const [bool, setBool] = useState<boolean | null>(() =>
    typeof initialValue === 'boolean' ? initialValue : null,
  );
  const [address, setAddress] = useState<AddressValue>(() => toAddressValue(initialValue));

  const prompt = useMemo(() => questionPrompt(question.id), [question.id]);
  const section = useMemo(() => sectionLabelForQuestion(question.id), [question.id]);

  /**
   * Normalizes the current draft into the submit value for this question type, or null if the
   * draft is not yet valid enough to submit (server does the authoritative validation).
   */
  function normalize(): unknown {
    switch (question.type) {
      case 'number': {
        if (scalar.trim() === '') {
          return null;
        }
        const n = Number(scalar);
        return Number.isNaN(n) ? null : n;
      }
      case 'boolean':
        return bool;
      case 'address': {
        const filled = Object.values(address).every((part) => part.trim() !== '');
        return filled ? address : null;
      }
      case 'text':
      case 'date':
      case 'choice':
      default:
        return scalar.trim() === '' ? null : scalar;
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const value = normalize();
    if (value === null) {
      return; // Nothing to submit yet; the submit button is also disabled in this case.
    }
    onSubmit(value);
  }

  const value = normalize();
  const canSubmit = value !== null && !disabled;

  return (
    <form className="q" onSubmit={handleSubmit} aria-label={`question-${question.id}`}>
      {section && (
        <div className="q__eyebrow">
          <span className="q__section">{section}</span>
        </div>
      )}
      <p className="q__prompt">{prompt}</p>

      <div className="field">{renderControl()}</div>

      <div className="q__actions">
        <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
          Continue
        </button>
      </div>
    </form>
  );

  function renderControl() {
    switch (question.type) {
      case 'choice':
        return (
          <select
            className="control"
            aria-label={question.id}
            value={scalar}
            disabled={disabled}
            onChange={(e) => setScalar(e.target.value)}
          >
            <option value="">Select…</option>
            {(question.choices ?? []).map((choice) => (
              <option key={choice} value={choice}>
                {choiceLabel(choice)}
              </option>
            ))}
          </select>
        );

      case 'boolean':
        return (
          <fieldset className="choices-group">
            <legend className="visually-hidden">{prompt}</legend>
            <div className="choices">
              <label className="choice">
                <input
                  type="radio"
                  name={question.id}
                  checked={bool === true}
                  disabled={disabled}
                  onChange={() => setBool(true)}
                />
                Yes
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name={question.id}
                  checked={bool === false}
                  disabled={disabled}
                  onChange={() => setBool(false)}
                />
                No
              </label>
            </div>
          </fieldset>
        );

      case 'address':
        return (
          <div className="address-grid">
            <input
              className="control"
              aria-label="street"
              name="street"
              autoComplete="address-line1"
              placeholder="Street address"
              value={address.street}
              disabled={disabled}
              onChange={(e) => setAddress((a) => ({ ...a, street: e.target.value }))}
            />
            <input
              className="control"
              aria-label="city"
              name="city"
              autoComplete="address-level2"
              placeholder="City"
              value={address.city}
              disabled={disabled}
              onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
            />
            <input
              className="control"
              aria-label="state"
              name="state"
              autoComplete="address-level1"
              placeholder="State"
              value={address.state}
              disabled={disabled}
              onChange={(e) => setAddress((a) => ({ ...a, state: e.target.value }))}
            />
            <input
              className="control"
              aria-label="postalCode"
              name="postalCode"
              autoComplete="postal-code"
              inputMode="numeric"
              placeholder="Postal code"
              value={address.postalCode}
              disabled={disabled}
              onChange={(e) => setAddress((a) => ({ ...a, postalCode: e.target.value }))}
            />
          </div>
        );

      case 'number':
        return (
          <input
            className="control"
            aria-label={question.id}
            type="number"
            value={scalar}
            disabled={disabled}
            onChange={(e) => setScalar(e.target.value)}
          />
        );

      case 'date':
        return (
          <input
            className="control"
            aria-label={question.id}
            type="date"
            value={scalar}
            disabled={disabled}
            onChange={(e) => setScalar(e.target.value)}
          />
        );

      case 'text':
      default:
        return (
          <input
            className="control"
            aria-label={question.id}
            type="text"
            value={scalar}
            disabled={disabled}
            onChange={(e) => setScalar(e.target.value)}
          />
        );
    }
  }
}
