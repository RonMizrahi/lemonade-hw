import { Injectable } from '@nestjs/common';
import { AnswerStatus } from '../common/enums';
import { Answer, ExternalLookup, SessionSummary } from '../database/entities';

/** Question ids grouped into the summary's personal-details section (spec §9). */
const PERSONAL_QUESTION_IDS = ['full_name', 'date_of_birth'] as const;

/** The residence-type question whose value keys the branch-specific section (spec §3, §9). */
const RESIDENCE_TYPE_QUESTION_ID = 'residence_type';

/** The address question feeding the property lookup (spec §3, §7). */
const ADDRESS_QUESTION_ID = 'property_address';

/** Question ids grouped into the summary's coverage section (spec §9). */
const COVERAGE_QUESTION_IDS = ['coverage_start_date', 'wants_earthquake_coverage'] as const;

/** Homeowner-branch question ids surfaced under `branchDetails` (spec §3). */
const OWN_BRANCH_QUESTION_IDS = [
  'year_built',
  'construction_type',
  'has_security_system',
  'security_system_monitored',
] as const;

/** Renter-branch question ids surfaced under `branchDetails` (spec §3). */
const RENT_BRANCH_QUESTION_IDS = [
  'monthly_rent',
  'landlord_has_insurance',
  'num_roommates',
] as const;

/** `dataSource` flag when the property data is the real lookup result (spec §9). */
const DATA_SOURCE_EXTERNAL = 'external';

/** `dataSource` flag when the property data is the permanent-failure fallback (spec §9). */
const DATA_SOURCE_FALLBACK = 'fallback';

/** The resolved property section of the summary (real result or fallback record). */
export interface PropertyDataSection {
  /** `external` for the real lookup result, `fallback` when a permanent failure applied. */
  dataSource: string;
  /** The raw resolved property data (real result fields, or the fallback record). */
  data: Record<string, unknown> | null;
}

/** The normalized completion summary persisted on the session (spec §9). */
export interface NormalizedSummary extends SessionSummary {
  personalDetails: Record<string, unknown>;
  residenceType: unknown;
  address: unknown;
  branchDetails: Record<string, unknown>;
  propertyData: PropertyDataSection;
  coverage: Record<string, unknown>;
}

/**
 * Builds the normalized completion summary from a session's active answers and its resolved
 * external lookup (spec §9). Pure — no I/O. Only `active` answers are included; the property
 * section carries a `dataSource` flag distinguishing the real result from the fallback.
 */
@Injectable()
export class SummaryBuilder {
  /**
   * Assembles the normalized summary object persisted on completion (spec §9).
   * @param answers all stored answers for the session (only `active` ones are included)
   * @param lookup the session's resolved external lookup (completed or permanently_failed)
   * @returns the normalized summary
   */
  build(answers: Answer[], lookup: ExternalLookup | null): NormalizedSummary {
    const active = this.activeValues(answers);
    return {
      personalDetails: this.pick(active, PERSONAL_QUESTION_IDS),
      residenceType: active[RESIDENCE_TYPE_QUESTION_ID] ?? null,
      address: active[ADDRESS_QUESTION_ID] ?? null,
      branchDetails: this.branchDetails(active),
      propertyData: this.propertyData(lookup),
      coverage: this.pick(active, COVERAGE_QUESTION_IDS),
    };
  }

  /**
   * Projects the session's `active` answers into a questionId → value map.
   * @param answers all stored answers for the session
   * @returns the active answer values keyed by question id
   */
  private activeValues(answers: Answer[]): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const answer of answers) {
      if (answer.status === AnswerStatus.Active) {
        values[answer.questionId] = answer.value;
      }
    }
    return values;
  }

  /**
   * Selects the branch-specific answers for whichever residence branch is active (spec §3).
   * @param active the active answer values keyed by question id
   * @returns the homeowner or renter branch answers present in the active set
   */
  private branchDetails(active: Record<string, unknown>): Record<string, unknown> {
    const ownDetails = this.pick(active, OWN_BRANCH_QUESTION_IDS);
    const rentDetails = this.pick(active, RENT_BRANCH_QUESTION_IDS);
    return { ...ownDetails, ...rentDetails };
  }

  /**
   * Builds the property-data section, flagging the real result vs. the fallback (spec §9).
   * @param lookup the session's resolved lookup, or null if never triggered
   * @returns the property data section with its `dataSource` flag
   */
  private propertyData(lookup: ExternalLookup | null): PropertyDataSection {
    const data = this.toRecord(lookup?.result ?? null);
    const dataSource = this.resolveDataSource(data);
    return { dataSource, data };
  }

  /**
   * Reads the `dataSource` flag from the resolved record, defaulting to `external`.
   * @param data the resolved property record, or null
   * @returns `fallback` when the record marks itself a fallback, otherwise `external`
   */
  private resolveDataSource(data: Record<string, unknown> | null): string {
    return data?.dataSource === DATA_SOURCE_FALLBACK ? DATA_SOURCE_FALLBACK : DATA_SOURCE_EXTERNAL;
  }

  /**
   * Copies the given question ids from the active set into a new record, omitting absent ones.
   * @param active the active answer values keyed by question id
   * @param ids the question ids to include
   * @returns a record of the present ids and their values
   */
  private pick(active: Record<string, unknown>, ids: readonly string[]): Record<string, unknown> {
    const picked: Record<string, unknown> = {};
    for (const id of ids) {
      if (id in active) {
        picked[id] = active[id];
      }
    }
    return picked;
  }

  /**
   * Narrows a jsonb value into a plain record, or null when it is not a plain object.
   * @param value the stored jsonb value
   * @returns a shallow copy record, or null
   */
  private toRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...value };
    }
    return null;
  }
}
