import { AnswerStatus, ExternalLookupStatus } from '../common/enums';
import { Answer, ExternalLookup } from '../database/entities';
import { SummaryBuilder } from './summary-builder';

/**
 * Builds a minimal Answer row for the builder under test.
 */
function answer(questionId: string, value: unknown, status = AnswerStatus.Active): Answer {
  return { questionId, value, status } as Answer;
}

/**
 * Builds a minimal ExternalLookup row carrying a status + result for the builder under test.
 */
function lookup(
  status: ExternalLookupStatus,
  result: Record<string, unknown> | null,
): ExternalLookup {
  return { status, result } as ExternalLookup;
}

/** A completed lookup result (real external property data). */
const EXTERNAL_RESULT: Record<string, unknown> = {
  dataSource: 'external',
  estimatedValue: 500000,
  squareFeet: 1800,
};

/** The permanent-failure fallback record. */
const FALLBACK_RESULT: Record<string, unknown> = {
  fallback: true,
  dataSource: 'fallback',
  reason: 'exhausted',
};

/** A full set of active homeowner-branch answers for a completable session. */
function homeownerAnswers(): Answer[] {
  return [
    answer('full_name', 'Jane Doe'),
    answer('date_of_birth', '1990-06-15'),
    answer('residence_type', 'own'),
    answer('property_address', { street: '1 Main St', city: 'Springfield' }),
    answer('year_built', 1990),
    answer('construction_type', 'brick'),
    answer('has_security_system', true),
    answer('security_system_monitored', true),
    answer('coverage_start_date', '2099-01-01'),
    answer('wants_earthquake_coverage', false),
  ];
}

describe('SummaryBuilder', () => {
  let builder: SummaryBuilder;

  beforeEach(() => {
    builder = new SummaryBuilder();
  });

  it('groups active answers into the normalized sections (homeowner branch)', () => {
    const summary = builder.build(
      homeownerAnswers(),
      lookup(ExternalLookupStatus.Completed, EXTERNAL_RESULT),
    );

    expect(summary.personalDetails).toEqual({
      full_name: 'Jane Doe',
      date_of_birth: '1990-06-15',
    });
    expect(summary.residenceType).toBe('own');
    expect(summary.address).toEqual({ street: '1 Main St', city: 'Springfield' });
    expect(summary.branchDetails).toEqual({
      year_built: 1990,
      construction_type: 'brick',
      has_security_system: true,
      security_system_monitored: true,
    });
    expect(summary.coverage).toEqual({
      coverage_start_date: '2099-01-01',
      wants_earthquake_coverage: false,
    });
  });

  it('includes only active answers, excluding irrelevant ones', () => {
    const answers = [
      answer('full_name', 'Jane Doe'),
      answer('residence_type', 'rent'),
      answer('monthly_rent', 2000),
      // a superseded homeowner answer left over from a branch switch
      answer('year_built', 1990, AnswerStatus.Irrelevant),
    ];

    const summary = builder.build(answers, lookup(ExternalLookupStatus.Completed, EXTERNAL_RESULT));

    expect(summary.branchDetails).toEqual({ monthly_rent: 2000 });
    expect(summary.branchDetails).not.toHaveProperty('year_built');
  });

  it('flags the real property result with dataSource=external', () => {
    const summary = builder.build(
      homeownerAnswers(),
      lookup(ExternalLookupStatus.Completed, EXTERNAL_RESULT),
    );

    expect(summary.propertyData.dataSource).toBe('external');
    expect(summary.propertyData.data).toEqual(EXTERNAL_RESULT);
  });

  it('flags the fallback property result with dataSource=fallback', () => {
    const summary = builder.build(
      homeownerAnswers(),
      lookup(ExternalLookupStatus.PermanentlyFailed, FALLBACK_RESULT),
    );

    expect(summary.propertyData.dataSource).toBe('fallback');
    expect(summary.propertyData.data).toEqual(FALLBACK_RESULT);
  });

  it('defaults propertyData to a null-external section when the lookup has no result', () => {
    const summary = builder.build(homeownerAnswers(), null);

    expect(summary.propertyData).toEqual({ dataSource: 'external', data: null });
  });
});
