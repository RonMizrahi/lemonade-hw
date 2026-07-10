/**
 * Asserts a response body matches the global error envelope `{ statusCode, error, message,
 * details? }` (spec §6) with the expected status code. Throws (failing the test) on drift.
 * @param body the parsed response body
 * @param expectedStatus the status code the envelope should carry
 */
export function expectErrorShape(body: unknown, expectedStatus: number): void {
  expect(body).toBeDefined();
  expect(typeof body).toBe('object');

  const envelope = body as Record<string, unknown>;
  expect(envelope.statusCode).toBe(expectedStatus);
  expect(typeof envelope.error).toBe('string');
  expect(typeof envelope.message).toBe('string');
  expect(Object.keys(envelope).sort()).toEqual(
    'details' in envelope
      ? ['details', 'error', 'message', 'statusCode']
      : ['error', 'message', 'statusCode'],
  );
}
