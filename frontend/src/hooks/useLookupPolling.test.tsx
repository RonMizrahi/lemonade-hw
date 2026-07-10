import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { OnboardingClient } from '../api/client';
import type { ExternalLookupState, SessionState } from '../api/types';
import { makeSessionState } from '../test/fixtures';
import { useLookupPolling } from './useLookupPolling';

/**
 * Builds a stub client whose `getState` returns queued sessions in order (last one repeats).
 * @param sessions the sessions to return on successive polls
 * @returns the stub client + a spy on getState
 */
function stubClient(sessions: SessionState[]) {
  let i = 0;
  const getState = vi.fn(async () => {
    const s = sessions[Math.min(i, sessions.length - 1)];
    i += 1;
    return s;
  });
  return { client: { getState } as unknown as OnboardingClient, getState };
}

const lookup = (status: ExternalLookupState['status']): ExternalLookupState => ({
  status,
  attempts: status === 'loading' ? 1 : 0,
  result: null,
});

describe('useLookupPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls while loading and reports each session to onSession', async () => {
    const sessionId = crypto.randomUUID();
    const loadingSession = makeSessionState({ sessionId, externalLookup: lookup('loading') });
    const doneSession = makeSessionState({ sessionId, externalLookup: lookup('completed') });
    const { client, getState } = stubClient([loadingSession, doneSession]);
    const onSession = vi.fn();

    renderHook(() =>
      useLookupPolling({
        client,
        sessionId,
        enabled: true,
        lookup: lookup('loading'),
        onSession,
        intervalMs: 100,
      }),
    );

    // First tick → still loading; second tick → completed, polling stops.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(getState).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenLastCalledWith(loadingSession);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(onSession).toHaveBeenLastCalledWith(doneSession);

    // No further polls after terminal.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(getState).toHaveBeenCalledTimes(2);
  });

  it('does not poll when the lookup is already terminal', async () => {
    const { client, getState } = stubClient([makeSessionState()]);
    renderHook(() =>
      useLookupPolling({
        client,
        sessionId: crypto.randomUUID(),
        enabled: true,
        lookup: lookup('completed'),
        onSession: vi.fn(),
        intervalMs: 100,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getState).not.toHaveBeenCalled();
  });

  it('does not poll when disabled', async () => {
    const { client, getState } = stubClient([makeSessionState()]);
    renderHook(() =>
      useLookupPolling({
        client,
        sessionId: crypto.randomUUID(),
        enabled: false,
        lookup: lookup('loading'),
        onSession: vi.fn(),
        intervalMs: 100,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getState).not.toHaveBeenCalled();
  });

  it('keeps polling after a transient poll error', async () => {
    const sessionId = crypto.randomUUID();
    const doneSession = makeSessionState({ sessionId, externalLookup: lookup('completed') });
    const getState = vi
      .fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue(doneSession);
    const client = { getState } as unknown as OnboardingClient;
    const onSession = vi.fn();

    renderHook(() =>
      useLookupPolling({
        client,
        sessionId,
        enabled: true,
        lookup: lookup('loading'),
        onSession,
        intervalMs: 100,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // error → swallowed, reschedule
    });
    expect(onSession).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // success → completed
    });
    expect(onSession).toHaveBeenCalledWith(doneSession);
  });

  it('stops polling on unmount', async () => {
    const { client, getState } = stubClient([
      makeSessionState({ externalLookup: lookup('loading') }),
    ]);
    const { unmount } = renderHook(() =>
      useLookupPolling({
        client,
        sessionId: crypto.randomUUID(),
        enabled: true,
        lookup: lookup('loading'),
        onSession: vi.fn(),
        intervalMs: 100,
      }),
    );
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getState).not.toHaveBeenCalled();
  });
});
