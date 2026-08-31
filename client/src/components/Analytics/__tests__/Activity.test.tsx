import React from 'react';
import '@testing-library/jest-dom';
import type { TGuardrailsActivityEntry } from 'librechat-data-provider';
import { render, screen, fireEvent } from 'test/layout-test-utils';
import { Activity } from '../Guardrails';

const mockActivityQuery = jest.fn();

jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGuardrailsActivityQuery: (limit: number) => mockActivityQuery(limit),
}));

function entry(overrides: Partial<TGuardrailsActivityEntry>): TGuardrailsActivityEntry {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    category: 'channel',
    action: 'channel.reply_sent',
    outcome: 'success',
    severity: 'info',
    actor: { type: 'agent', name: 'silkroad' },
    target: { type: 'imessage', id: 'chat-1' },
    metadata: {},
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

const entries: TGuardrailsActivityEntry[] = [
  entry({ id: 'a', action: 'channel.reply_sent', target: { type: 'imessage', id: 'c' } }),
  entry({
    id: 'b',
    category: 'approval',
    action: 'approval.approved',
    actor: { type: 'user', id: 'u1', name: 'owner' },
    target: { type: 'approval', id: 'ap1' },
    metadata: { kind: 'email', hasDraft: true },
  }),
  entry({
    id: 'c',
    category: 'channel',
    action: 'channel.draft_blocked',
    outcome: 'denied',
    target: { type: 'draft', id: 'd1' },
    metadata: { blockedDomains: 'evil.example' },
  }),
  entry({
    id: 'd',
    category: 'guardrail',
    action: 'guardrail.budget_alert',
    severity: 'warning',
    target: { type: 'budget', id: '2026-08' },
    metadata: { multiple: 2 },
  }),
  entry({
    id: 'e',
    category: 'brain',
    action: 'brain.write_applied',
    target: { type: 'note', id: 'Henderson Invoice' },
  }),
];

describe('Activity', () => {
  beforeEach(() => mockActivityQuery.mockReset());

  it('shows a skeleton while loading', () => {
    mockActivityQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<Activity />);
    expect(screen.getByLabelText('Activity').querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('renders one sentence per audit entry with outcome chips', () => {
    mockActivityQuery.mockReturnValue({
      data: { entries, total: entries.length, nextCursor: null },
      isLoading: false,
      isError: false,
    });
    render(<Activity />);
    expect(screen.getByText('Replied over iMessage')).toBeInTheDocument();
    expect(screen.getByText('You approved an email draft')).toBeInTheDocument();
    expect(screen.getByText('Blocked a draft to evil.example')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Spend crossed 2× expected')).toBeInTheDocument();
    expect(screen.getByText('Brain note updated: Henderson Invoice')).toBeInTheDocument();
    expect(screen.queryByText('Show more')).toBeNull();
  });

  it('offers "Show more" when the first page is full and raises the limit', () => {
    const full = Array.from({ length: 20 }, (_, i) => entry({ id: `row-${i}` }));
    mockActivityQuery.mockReturnValue({
      data: { entries: full, total: 20, nextCursor: null },
      isLoading: false,
      isError: false,
    });
    render(<Activity />);
    expect(mockActivityQuery).toHaveBeenLastCalledWith(20);
    fireEvent.click(screen.getByText('Show more'));
    expect(mockActivityQuery).toHaveBeenLastCalledWith(50);
  });

  it('renders empty and error states', () => {
    mockActivityQuery.mockReturnValue({
      data: { entries: [], total: 0, nextCursor: null },
      isLoading: false,
      isError: false,
    });
    const { unmount } = render(<Activity />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    unmount();
    mockActivityQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<Activity />);
    expect(screen.getByText('Activity could not be loaded')).toBeInTheDocument();
  });
});
