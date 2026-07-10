import { envValidationSchema, NodeEnv } from './env.validation';

describe('envValidationSchema', () => {
  it('applies defaults when optional vars are omitted', () => {
    const { error, value } = envValidationSchema.validate({});

    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe(NodeEnv.Development);
    expect(value.HTTP_PORT).toBe(3000);
    expect(value.DB_PORT).toBe(5432);
    expect(value.REDIS_PORT).toBe(6379);
    expect(value.EXTERNAL_LOOKUP_MAX_TRIGGERS).toBe(3);
    expect(value.LOOKUP_FAILURE_RATE).toBe(0.1);
  });

  it('coerces numeric env strings to numbers', () => {
    const { error, value } = envValidationSchema.validate({ HTTP_PORT: '4100', DB_PORT: '6000' });

    expect(error).toBeUndefined();
    expect(value.HTTP_PORT).toBe(4100);
    expect(value.DB_PORT).toBe(6000);
  });

  it('rejects an invalid NODE_ENV', () => {
    const { error } = envValidationSchema.validate({ NODE_ENV: 'staging' });

    expect(error).toBeDefined();
    expect(error?.message).toContain('NODE_ENV');
  });

  it('rejects a non-port HTTP_PORT', () => {
    const { error } = envValidationSchema.validate({ HTTP_PORT: '70000' });

    expect(error).toBeDefined();
  });

  it('rejects a failure rate outside [0,1]', () => {
    const { error } = envValidationSchema.validate({ LOOKUP_FAILURE_RATE: '1.5' });

    expect(error).toBeDefined();
  });

  it('allows unknown env vars (whitelist off for env)', () => {
    const { error } = envValidationSchema.validate({ SOMETHING_ELSE: 'x' }, { allowUnknown: true });

    expect(error).toBeUndefined();
  });
});
