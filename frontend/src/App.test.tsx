import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { OnboardingClient } from './api/client';
import { resetMockApi, server } from './test/mockApi';

/**
 * App-level money-path journey against the MOCKED API contract (MSW): this is the mocked-API
 * "e2e recipe" required by M7 — it exercises the real {@link OnboardingClient} (real fetch,
 * generated Idempotency-Key, expectedVersion echo) end-to-end, no live backend.
 *
 * Journey (spec §11): start → homeowner branch → address triggers the lookup badge → keep
 * answering while the lookup is loading → badge reaches completed → Complete → summary.
 */
describe('App — money-path onboarding journey (mocked API)', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    server.resetHandlers();
    resetMockApi();
  });
  afterAll(() => server.close());

  it('walks the homeowner branch, watches the lookup complete, and shows the summary', async () => {
    const user = userEvent.setup();
    // Short poll interval so the badge reaches completed quickly under real timers.
    render(<App client={new OnboardingClient('')} />);

    // Start.
    await user.click(screen.getByRole('button', { name: /start/i }));

    // full_name.
    const nameInput = await screen.findByLabelText('full_name');
    await user.type(nameInput, 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // residence_type = own.
    const residenceSelect = await screen.findByLabelText('residence_type');
    await user.selectOptions(residenceSelect, 'own');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // property_address — this triggers the lookup.
    await screen.findByLabelText('street');
    await user.type(screen.getByLabelText('street'), '1 Main St');
    await user.type(screen.getByLabelText('city'), 'Springfield');
    await user.type(screen.getByLabelText('state'), 'IL');
    await user.type(screen.getByLabelText('postalCode'), '62704');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // The badge shows the lookup is running right after the address is submitted.
    const badge = await screen.findByRole('status');
    expect(badge).toHaveTextContent(/checking/i);

    // Keep answering unrelated questions WHILE the lookup runs in the background.
    const yearInput = await screen.findByLabelText('year_built');
    await user.type(yearInput, '1998');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const dateInput = await screen.findByLabelText('coverage_start_date');
    await user.type(dateInput, '2026-08-01');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const earthquakeYes = await screen.findByLabelText('Yes');
    await user.click(earthquakeYes);
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Background polling flips the badge to the "found" (completed) state.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/found/i), {
      timeout: 5000,
    });

    // Complete becomes enabled once all answered + lookup terminal.
    const completeButton = await screen.findByRole('button', { name: /complete/i });
    await waitFor(() => expect(completeButton).toBeEnabled());
    await user.click(completeButton);

    // Summary view is shown with the collected answers.
    const summary = await screen.findByRole('region', { name: /summary/i });
    expect(within(summary).getByText(/all set/i)).toBeInTheDocument();
    expect(within(summary).getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('edits a prior choice answer with the correct select control seeded from the stored value', async () => {
    const user = userEvent.setup();
    render(<App client={new OnboardingClient('')} />);

    await user.click(screen.getByRole('button', { name: /start/i }));

    await user.type(await screen.findByLabelText('full_name'), 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await user.selectOptions(await screen.findByLabelText('residence_type'), 'own');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // The answered residence_type appears in the revisitable answer list; edit that row.
    const answers = await screen.findByRole('region', { name: /answered-questions/i });
    const residenceRow = within(answers)
      .getByText(/residence type/i)
      .closest('li') as HTMLElement;
    await user.click(within(residenceRow).getByRole('button', { name: /edit/i }));

    // The edit renders the CHOICE control (a select) seeded with "own" — not a plain text box.
    const editRegion = await screen.findByRole('region', { name: /edit-question/i });
    const select = within(editRegion).getByLabelText('residence_type');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('own');

    // Change it to rent and save; the answer-list row reflects the edited value.
    await user.selectOptions(select, 'rent');
    await user.click(within(editRegion).getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      const row = within(screen.getByRole('region', { name: /answered-questions/i }))
        .getByText(/residence type/i)
        .closest('li') as HTMLElement;
      expect(row).toHaveTextContent(/rent/i);
    });
  });
});
