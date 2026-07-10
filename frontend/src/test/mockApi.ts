import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { Question, SessionState } from '../api/types';

/**
 * A minimal, stateful mock of the onboarding API for the App-level money-path test. It models
 * just enough of the contract (spec §6/§7) to drive the homeowner journey:
 *   start → full_name → residence_type=own → property_address (triggers lookup) →
 *   keep answering while the lookup runs → lookup completes after a couple polls → complete.
 *
 * It is NOT a full flow engine — it advances a scripted question queue and flips the lookup to
 * `completed` after a few polls, exercising the real {@link OnboardingClient} (real fetch,
 * Idempotency-Key, expectedVersion) end-to-end without a live backend.
 */

/** The scripted homeowner question sequence. */
const SCRIPT: Question[] = [
  { id: 'full_name', type: 'text' },
  { id: 'residence_type', type: 'choice', choices: ['own', 'rent'] },
  { id: 'property_address', type: 'address' },
  { id: 'year_built', type: 'number' },
  { id: 'coverage_start_date', type: 'date' },
  { id: 'wants_earthquake_coverage', type: 'boolean' },
];

interface MockSession {
  version: number;
  answers: { questionId: string; value: unknown }[];
  index: number; // pointer into SCRIPT
  lookup: SessionState['externalLookup'];
  addressAnswered: boolean;
  pollsSinceAddress: number;
  status: 'in_progress' | 'completed';
  summary: Record<string, unknown> | null;
}

/** Number of polls after the address is answered before the lookup flips to completed. */
const POLLS_TO_COMPLETE = 2;

/**
 * Projects the mock session into the contract's session-state shape.
 * @param id the session id
 * @param s the internal mock session
 * @returns the session state DTO
 */
function project(id: string, s: MockSession): SessionState {
  const next: Question | null = s.index < SCRIPT.length ? SCRIPT[s.index] : null;
  const lookupTerminal =
    s.lookup.status === 'completed' || s.lookup.status === 'permanently_failed';
  const allAnswered = s.index >= SCRIPT.length;

  return {
    sessionId: id,
    status: s.status,
    version: s.version,
    currentQuestion: next,
    answeredQuestions: s.answers.map((a) => ({ ...a, status: 'active' as const })),
    externalLookup: s.lookup,
    completion: {
      canComplete: allAnswered && lookupTerminal && s.status === 'in_progress',
      missingRequired: next ? [next.id] : [],
    },
    summary: s.summary,
  };
}

/** In-memory session store for the mock server. */
const sessions = new Map<string, MockSession>();

/** Resets all mock state (call between tests). */
export function resetMockApi(): void {
  sessions.clear();
}

/**
 * Advances the lookup toward completion on each poll once the address has been answered.
 * @param s the mock session to mutate
 */
function advanceLookupOnPoll(s: MockSession): void {
  if (!s.addressAnswered || s.lookup.status === 'completed') {
    return;
  }
  s.pollsSinceAddress += 1;
  s.lookup =
    s.pollsSinceAddress >= POLLS_TO_COMPLETE
      ? { status: 'completed', attempts: 1, result: { estimatedValue: 500000 } }
      : { status: 'loading', attempts: 1, result: null };
}

/** The MSW handlers implementing the mock contract. */
export const handlers = [
  http.post('/onboarding/sessions', () => {
    const id = crypto.randomUUID();
    const session: MockSession = {
      version: 1,
      answers: [],
      index: 0,
      lookup: { status: 'not_started', attempts: 0, result: null },
      addressAnswered: false,
      pollsSinceAddress: 0,
      status: 'in_progress',
      summary: null,
    };
    sessions.set(id, session);
    return HttpResponse.json(project(id, session), { status: 201 });
  }),

  http.get('/onboarding/sessions/:id', ({ params }) => {
    const id = params.id as string;
    const s = sessions.get(id);
    if (!s) {
      return HttpResponse.json(
        { statusCode: 404, error: 'Not Found', message: 'session not found' },
        { status: 404 },
      );
    }
    advanceLookupOnPoll(s);
    return HttpResponse.json(project(id, s));
  }),

  http.post('/onboarding/sessions/:id/answers', async ({ params, request }) => {
    const id = params.id as string;
    const s = sessions.get(id)!;
    const body = (await request.json()) as { questionId: string; value: unknown };
    s.answers.push({ questionId: body.questionId, value: body.value });
    s.index += 1;
    s.version += 1;
    if (body.questionId === 'property_address') {
      s.addressAnswered = true;
      s.lookup = { status: 'loading', attempts: 1, result: null };
    }
    return HttpResponse.json(project(id, s));
  }),

  http.put('/onboarding/sessions/:id/answers/:questionId', async ({ params, request }) => {
    const id = params.id as string;
    const questionId = params.questionId as string;
    const s = sessions.get(id)!;
    const body = (await request.json()) as { value: unknown };
    const existing = s.answers.find((a) => a.questionId === questionId);
    if (existing) {
      existing.value = body.value;
    }
    s.version += 1;
    return HttpResponse.json(project(id, s));
  }),

  http.post('/onboarding/sessions/:id/complete', ({ params }) => {
    const id = params.id as string;
    const s = sessions.get(id)!;
    s.status = 'completed';
    s.summary = Object.fromEntries(s.answers.map((a) => [a.questionId, a.value]));
    s.version += 1;
    return HttpResponse.json(project(id, s));
  }),
];

/** The MSW node server used by the App test. */
export const server = setupServer(...handlers);
