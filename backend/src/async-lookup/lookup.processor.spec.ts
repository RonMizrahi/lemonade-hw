import { randomUUID } from 'node:crypto';
import { Job } from 'bullmq';
import { ExternalLookupStatus } from '../common/enums';
import { ExternalLookup } from '../database/entities';
import { AnswerRepository } from '../onboarding/repositories/answer.repository';
import { ExternalLookupRepository } from '../onboarding/repositories/external-lookup.repository';
import { LookupProcessor } from './lookup.processor';
import { ExternalLookupJobData } from './queue.constants';
import { PropertyLookupResult, SimulatedPropertyService } from './simulated-property.service';

const MOCK_RESULT: PropertyLookupResult = {
  dataSource: 'external',
  estimatedValue: 1,
  squareFeet: 1,
  yearBuilt: 2000,
  floodZone: 'X',
  roofType: 'tile',
  hazards: [],
};

/**
 * Builds a lookup row for the processor tests.
 */
function buildLookup(overrides: Partial<ExternalLookup> = {}): ExternalLookup {
  const lookup = new ExternalLookup();
  lookup.id = randomUUID();
  lookup.sessionId = randomUUID();
  lookup.status = ExternalLookupStatus.NotStarted;
  lookup.generation = 2;
  lookup.triggers = 1;
  lookup.maxTriggers = 3;
  lookup.jobAttempts = 0;
  lookup.result = null;
  lookup.error = null;
  return Object.assign(lookup, overrides);
}

/**
 * Builds a job whose data carries the given lookup id + generation.
 */
function buildJob(data: ExternalLookupJobData): Job<ExternalLookupJobData> {
  return { data } as unknown as Job<ExternalLookupJobData>;
}

describe('LookupProcessor', () => {
  let lookups: jest.Mocked<Pick<ExternalLookupRepository, 'findById' | 'save'>>;
  let answers: jest.Mocked<Pick<AnswerRepository, 'findByQuestion'>>;
  let sim: jest.Mocked<SimulatedPropertyService>;
  let processor: LookupProcessor;

  beforeEach(() => {
    lookups = { findById: jest.fn(), save: jest.fn() };
    answers = { findByQuestion: jest.fn().mockResolvedValue(null) };
    sim = { lookup: jest.fn() };
    processor = new LookupProcessor(
      lookups as unknown as ExternalLookupRepository,
      answers as unknown as AnswerRepository,
      sim,
    );
  });

  it('drops a stale job without touching status or the sim service', async () => {
    const lookup = buildLookup({ generation: 3 });
    lookups.findById.mockResolvedValue(lookup);

    await processor.process(buildJob({ lookupId: lookup.id, generation: 2 }));

    expect(sim.lookup).not.toHaveBeenCalled();
    expect(lookups.save).not.toHaveBeenCalled();
  });

  it('drops a duplicate job for an already-completed lookup without re-running the sim', async () => {
    const lookup = buildLookup({ generation: 2, status: ExternalLookupStatus.Completed });
    lookups.findById.mockResolvedValue(lookup);

    await processor.process(buildJob({ lookupId: lookup.id, generation: 2 }));

    expect(sim.lookup).not.toHaveBeenCalled();
    expect(lookups.save).not.toHaveBeenCalled();
  });

  it('marks loading then completed with the result on success', async () => {
    const lookup = buildLookup({ generation: 2 });
    lookups.findById.mockResolvedValue(lookup);
    lookups.save.mockImplementation((row) => Promise.resolve(row));
    sim.lookup.mockResolvedValue(MOCK_RESULT);

    await processor.process(buildJob({ lookupId: lookup.id, generation: 2 }));

    expect(sim.lookup).toHaveBeenCalledTimes(1);
    expect(lookup.status).toBe(ExternalLookupStatus.Completed);
    expect(lookup.result).toEqual(MOCK_RESULT);
    expect(lookup.jobAttempts).toBe(1);
  });

  it('propagates a sim failure so BullMQ can retry', async () => {
    const lookup = buildLookup({ generation: 2 });
    lookups.findById.mockResolvedValue(lookup);
    lookups.save.mockImplementation((row) => Promise.resolve(row));
    sim.lookup.mockRejectedValue(new Error('boom'));

    await expect(
      processor.process(buildJob({ lookupId: lookup.id, generation: 2 })),
    ).rejects.toThrow('boom');
    expect(lookup.status).toBe(ExternalLookupStatus.Loading);
  });

  it('on exhausted attempts, transitions to failed (budget remaining)', async () => {
    const lookup = buildLookup({ generation: 2, triggers: 1, maxTriggers: 3 });
    lookups.findById.mockResolvedValue(lookup);
    lookups.save.mockImplementation((row) => Promise.resolve(row));
    const job = {
      data: { lookupId: lookup.id, generation: 2 },
      opts: { attempts: 3 },
      attemptsMade: 3,
    } as unknown as Job<ExternalLookupJobData>;

    await processor.onFailed(job, new Error('down'));

    expect(lookup.status).toBe(ExternalLookupStatus.Failed);
  });

  it('does not clobber an already-completed lookup on a late failed event', async () => {
    const lookup = buildLookup({ generation: 2, status: ExternalLookupStatus.Completed });
    lookups.findById.mockResolvedValue(lookup);
    const job = {
      data: { lookupId: lookup.id, generation: 2 },
      opts: { attempts: 1 },
      attemptsMade: 1,
    } as unknown as Job<ExternalLookupJobData>;

    await processor.onFailed(job, new Error('late failure'));

    expect(lookup.status).toBe(ExternalLookupStatus.Completed);
    expect(lookups.save).not.toHaveBeenCalled();
  });

  it('ignores a non-final failed event (attempts remain)', async () => {
    const lookup = buildLookup({ generation: 2 });
    lookups.findById.mockResolvedValue(lookup);
    const job = {
      data: { lookupId: lookup.id, generation: 2 },
      opts: { attempts: 3 },
      attemptsMade: 1,
    } as unknown as Job<ExternalLookupJobData>;

    await processor.onFailed(job, new Error('transient'));

    expect(lookups.findById).not.toHaveBeenCalled();
    expect(lookups.save).not.toHaveBeenCalled();
  });
});
