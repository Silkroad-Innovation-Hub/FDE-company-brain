import React from 'react';
import '@testing-library/jest-dom';
import type { TGuardrailsStatus } from 'librechat-data-provider';
import { render, screen } from 'test/layout-test-utils';
import { BudgetTile } from '../Guardrails';

const mockStatusQuery = jest.fn();

jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGuardrailsStatusQuery: () => mockStatusQuery(),
}));

const status: TGuardrailsStatus = {
  month: '2026-08',
  spendUsd: 131.25,
  expectedUsd: 50,
  multiple: 2.6,
  alerted: [1, 2],
  byContextUsd: { message: 120, channel: 11.25 },
  paused: false,
  pausedVia: null,
};

describe('BudgetTile', () => {
  beforeEach(() => mockStatusQuery.mockReset());

  it('shows a skeleton while loading', () => {
    mockStatusQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<BudgetTile />);
    expect(screen.getByLabelText('Token spend this month')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders spend, expectation, meter, and the alerted chip', () => {
    mockStatusQuery.mockReturnValue({ data: status, isLoading: false, isError: false });
    render(<BudgetTile />);
    expect(screen.getByText('$131')).toBeInTheDocument();
    expect(screen.getByText('of $50.00 expected · 2.6×')).toBeInTheDocument();
    expect(screen.getByText('Over expected')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '2.6');
  });

  it('renders on-track and paused states', () => {
    mockStatusQuery.mockReturnValue({
      data: { ...status, spendUsd: 12, multiple: 0.24, alerted: [] },
      isLoading: false,
      isError: false,
    });
    const { unmount } = render(<BudgetTile />);
    expect(screen.getByText('On track')).toBeInTheDocument();
    unmount();
    mockStatusQuery.mockReturnValue({
      data: { ...status, paused: true, pausedVia: 'budget' },
      isLoading: false,
      isError: false,
    });
    render(<BudgetTile />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('falls back to an unavailable state on error', () => {
    mockStatusQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<BudgetTile />);
    expect(screen.getByText('Spend unavailable')).toBeInTheDocument();
  });
});
