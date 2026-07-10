import { useEffect, useRef, useState } from 'react';
import type { OnboardingClient } from '../api/client';
import type { ExternalLookupState, SessionState } from '../api/types';

/** Lookup states that are terminal — polling stops once one is reached. */
const TERMINAL_STATES = new Set(['completed', 'failed', 'permanently_failed']);

/** Default background poll interval (ms). */
const DEFAULT_INTERVAL_MS = 1500;

interface UseLookupPollingArgs {
  client: OnboardingClient;
  sessionId: string | null;
  /** Only poll while true (e.g. session active and lookup not yet terminal). */
  enabled: boolean;
  /** Latest known lookup state, seeded from the session state the App already holds. */
  lookup: ExternalLookupState | null;
  /** Notified with each freshly-polled session so the App can reconcile `version`. */
  onSession: (session: SessionState) => void;
  intervalMs?: number;
}

/**
 * Background poller for the external property lookup. While `enabled` and the lookup is not yet
 * terminal, it fetches `GET /onboarding/sessions/:id` on an interval and reports each result via
 * `onSession`, so the badge tracks `not_started → loading → completed | failed`
 * (`permanently_failed` renders as "fallback applied"). Polling stops automatically once the
 * lookup reaches a terminal state or the component unmounts.
 *
 * The customer keeps answering other questions while this runs — that is the whole point of the
 * async pipeline (spec §7); this hook is what makes the badge update in the background without
 * blocking the wizard.
 *
 * @param args the poller configuration
 * @returns `{ polling }` — whether a poll loop is currently active
 */
export function useLookupPolling({
  client,
  sessionId,
  enabled,
  lookup,
  onSession,
  intervalMs = DEFAULT_INTERVAL_MS,
}: UseLookupPollingArgs): { polling: boolean } {
  const [polling, setPolling] = useState(false);

  // Keep the latest callback in a ref so the effect doesn't resubscribe on every render.
  const onSessionRef = useRef(onSession);
  useEffect(() => {
    onSessionRef.current = onSession;
  }, [onSession]);

  const status = lookup?.status ?? null;
  const isTerminal = status !== null && TERMINAL_STATES.has(status);
  const shouldPoll = enabled && sessionId !== null && !isTerminal;

  useEffect(() => {
    if (!shouldPoll || sessionId === null) {
      setPolling(false);
      return;
    }

    let cancelled = false;
    setPolling(true);

    const tick = async () => {
      try {
        const session = await client.getState(sessionId);
        if (cancelled) {
          return;
        }
        onSessionRef.current(session);
        if (TERMINAL_STATES.has(session.externalLookup.status)) {
          setPolling(false);
          return; // Terminal — let the effect tear down; a re-render won't reschedule.
        }
      } catch {
        // Swallow transient poll errors; the next tick retries. The badge simply stays put.
      }
      if (!cancelled) {
        timer = window.setTimeout(tick, intervalMs);
      }
    };

    let timer = window.setTimeout(tick, intervalMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [client, sessionId, shouldPoll, intervalMs]);

  return { polling };
}
