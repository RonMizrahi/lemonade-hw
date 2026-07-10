import { describe, expect, it } from 'vitest';
import { questionDescriptor } from './flow';

describe('questionDescriptor (edit-path control resolution)', () => {
  it('resolves a choice question with its choices (so an edit renders a select, not a text box)', () => {
    expect(questionDescriptor('residence_type')).toEqual({
      id: 'residence_type',
      type: 'choice',
      choices: ['own', 'rent'],
    });
  });

  it('resolves a boolean question', () => {
    expect(questionDescriptor('has_security_system')).toEqual({
      id: 'has_security_system',
      type: 'boolean',
    });
  });

  it('resolves an address question', () => {
    expect(questionDescriptor('property_address')).toEqual({
      id: 'property_address',
      type: 'address',
    });
  });

  it('resolves a number question', () => {
    expect(questionDescriptor('year_built')).toEqual({ id: 'year_built', type: 'number' });
  });

  it('falls back to a text input for an unknown id', () => {
    const id = `unknown_${crypto.randomUUID()}`;
    expect(questionDescriptor(id)).toEqual({ id, type: 'text' });
  });
});
