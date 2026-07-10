import type {
  ApiErrorBody,
  CompleteBody,
  EditAnswerBody,
  ExternalLookupStatus,
  SessionState,
  SubmitAnswerBody,
} from './types';

const DEFAULT_BASE_URL = '';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60000;

/** Terminal lookup states — polling stops once one is reached. */
const TERMINAL_LOOKUP_STATES: ReadonlySet<ExternalLookupStatus> = new Set([
  'completed',
  'failed',
  'permanently_failed',
]);

/**
 * An error thrown when the API returns a non-2xx response, carrying the parsed envelope.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }
}

/**
 * Generates a fresh idempotency key for a write request.
 * @returns a random UUID
 */
function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Typed client for the onboarding API, mirroring the frozen contract (spec §6). Handles
 * Idempotency-Key generation, `expectedVersion` echo, error envelopes, and lookup polling.
 * The full wizard (M7) consumes this client.
 */
export class OnboardingClient {
  constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

  /**
   * Issues a request and parses the JSON body, throwing {@link ApiError} on non-2xx.
   * @param path the request path
   * @param init the fetch init options
   * @returns the parsed response body typed as T
   */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

    const body: unknown = res.status === 204 ? null : await res.json();
    if (!res.ok) {
      throw new ApiError(res.status, body as ApiErrorBody);
    }
    return body as T;
  }

  /**
   * Starts a new session.
   * @returns the initial session state
   */
  startSession(): Promise<SessionState> {
    return this.request<SessionState>('/onboarding/sessions', { method: 'POST' });
  }

  /**
   * Fetches the current session state (polling target).
   * @param sessionId the session id
   * @returns the session state
   */
  getState(sessionId: string): Promise<SessionState> {
    return this.request<SessionState>(`/onboarding/sessions/${sessionId}`);
  }

  /**
   * Submits an answer to the current question (idempotent).
   * @param sessionId the session id
   * @param body the answer body (echoes `expectedVersion`)
   * @returns the recalculated session state
   */
  submitAnswer(sessionId: string, body: SubmitAnswerBody): Promise<SessionState> {
    return this.request<SessionState>(`/onboarding/sessions/${sessionId}/answers`, {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify(body),
    });
  }

  /**
   * Edits a prior answer, recalculating the flow.
   * @param sessionId the session id
   * @param questionId the question being edited
   * @param body the edit body (echoes `expectedVersion`)
   * @returns the recalculated session state
   */
  editAnswer(sessionId: string, questionId: string, body: EditAnswerBody): Promise<SessionState> {
    return this.request<SessionState>(
      `/onboarding/sessions/${sessionId}/answers/${questionId}`,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  }

  /**
   * Retries a failed external lookup (idempotent).
   * @param sessionId the session id
   * @returns the session state with the re-enqueued lookup
   */
  retryLookup(sessionId: string): Promise<SessionState> {
    return this.request<SessionState>(`/onboarding/sessions/${sessionId}/external-lookup/retry`, {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
    });
  }

  /**
   * Completes the session.
   * @param sessionId the session id
   * @param body the complete body (echoes `expectedVersion`)
   * @returns the completed session state with summary
   */
  complete(sessionId: string, body: CompleteBody): Promise<SessionState> {
    return this.request<SessionState>(`/onboarding/sessions/${sessionId}/complete`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Polls `getState` until the external lookup reaches a terminal state (or times out).
   * @param sessionId the session id
   * @param intervalMs poll interval (default 1500ms)
   * @param timeoutMs overall timeout (default 60s)
   * @returns the session state once the lookup is terminal
   * @throws Error if the timeout elapses first
   */
  async pollUntilLookupTerminal(
    sessionId: string,
    intervalMs: number = POLL_INTERVAL_MS,
    timeoutMs: number = POLL_TIMEOUT_MS,
  ): Promise<SessionState> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = await this.getState(sessionId);
      if (TERMINAL_LOOKUP_STATES.has(state.externalLookup.status)) {
        return state;
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for external lookup to reach a terminal state');
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
