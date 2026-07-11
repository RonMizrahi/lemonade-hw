import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryView } from './SummaryView';

describe('SummaryView', () => {
  it('renders free-text values verbatim (not humanized) and labels known choices', () => {
    render(
      <SummaryView
        summary={{
          full_name: 'mary_jane',
          residence_type: 'own',
          wants_earthquake_coverage: true,
        }}
      />,
    );
    // Free text with an underscore must NOT be title-cased into "Mary Jane".
    expect(screen.getByText('mary_jane')).toBeInTheDocument();
    // Known choice values ARE labelled.
    expect(screen.getByText('Own')).toBeInTheDocument();
    // Booleans render as Yes/No.
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('flattens object values (e.g. address) into labelled pairs', () => {
    render(
      <SummaryView
        summary={{ property_address: { street: '1 Main St', city: 'Springfield' } }}
      />,
    );
    expect(screen.getByText(/1 Main St/)).toBeInTheDocument();
    expect(screen.getByText(/Springfield/)).toBeInTheDocument();
  });

  it('renders a placeholder when the summary is empty', () => {
    render(<SummaryView summary={{}} />);
    expect(screen.getByText(/no summary details/i)).toBeInTheDocument();
  });
});
