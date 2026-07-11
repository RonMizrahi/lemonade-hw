import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeQuestion } from '../test/fixtures';
import { QuestionInput } from './QuestionInput';

describe('QuestionInput per-type rendering + normalization', () => {
  it('renders a text input and submits the string as-is', async () => {
    const onSubmit = vi.fn();
    render(<QuestionInput question={makeQuestion('full_name', 'text')} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('full_name'), 'Ada Lovelace');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith('Ada Lovelace');
  });

  it('renders a number input and submits a JS number', async () => {
    const onSubmit = vi.fn();
    render(<QuestionInput question={makeQuestion('year_built', 'number')} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('year_built'), '1998');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith(1998);
  });

  it('renders a boolean as radios and submits true/false', async () => {
    const onSubmit = vi.fn();
    render(
      <QuestionInput question={makeQuestion('has_security_system', 'boolean')} onSubmit={onSubmit} />,
    );

    await userEvent.click(screen.getByLabelText('Yes'));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith(true);
  });

  it('renders a date input and submits the ISO date string', async () => {
    const onSubmit = vi.fn();
    render(
      <QuestionInput question={makeQuestion('coverage_start_date', 'date')} onSubmit={onSubmit} />,
    );

    await userEvent.type(screen.getByLabelText('coverage_start_date'), '2026-08-01');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith('2026-08-01');
  });

  it('renders a choice select from choices and submits the selected value', async () => {
    const onSubmit = vi.fn();
    render(
      <QuestionInput
        question={makeQuestion('residence_type', 'choice', ['own', 'rent'])}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('residence_type'), 'own');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith('own');
  });

  it('renders an address as multiple fields and submits a structured object', async () => {
    const onSubmit = vi.fn();
    render(
      <QuestionInput question={makeQuestion('property_address', 'address')} onSubmit={onSubmit} />,
    );

    await userEvent.type(screen.getByLabelText('street'), '1 Main St');
    await userEvent.type(screen.getByLabelText('city'), 'Springfield');
    await userEvent.type(screen.getByLabelText('state'), 'IL');
    await userEvent.type(screen.getByLabelText('postalCode'), '62704');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      street: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62704',
    });
  });

  it('disables submit until the input is non-empty', async () => {
    const onSubmit = vi.fn();
    render(<QuestionInput question={makeQuestion('full_name', 'text')} onSubmit={onSubmit} />);

    const button = screen.getByRole('button', { name: /continue/i });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText('full_name'), 'x');
    expect(button).toBeEnabled();
  });

  it('does not submit an incomplete address', async () => {
    const onSubmit = vi.fn();
    render(
      <QuestionInput question={makeQuestion('property_address', 'address')} onSubmit={onSubmit} />,
    );

    await userEvent.type(screen.getByLabelText('street'), '1 Main St');
    // City/state/postal left blank → submit stays disabled.
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('seeds the input from initialValue when editing', () => {
    render(
      <QuestionInput
        question={makeQuestion('full_name', 'text')}
        initialValue="Grace Hopper"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('full_name')).toHaveValue('Grace Hopper');
  });

  it('disables all controls when disabled', () => {
    render(
      <QuestionInput question={makeQuestion('full_name', 'text')} disabled onSubmit={vi.fn()} />,
    );
    expect(screen.getByLabelText('full_name')).toBeDisabled();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });
});
