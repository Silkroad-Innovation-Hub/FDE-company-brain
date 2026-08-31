import React from 'react';
import '@testing-library/jest-dom';
import type { TApproval, TBrainApproval } from 'librechat-data-provider';
import { render, screen, fireEvent } from 'test/layout-test-utils';
import Actions from '../Actions';

const mockApprovalsQuery = jest.fn();
const mockBrainApprovalsQuery = jest.fn();
const mockDecide = jest.fn();
const mockDecideMemory = jest.fn();

jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useApprovalsQuery: () => mockApprovalsQuery(),
  useBrainApprovalsQuery: () => mockBrainApprovalsQuery(),
  useDecideApprovalMutation: () => ({ mutate: mockDecide, isLoading: false }),
  useDecideBrainApprovalMutation: () => ({ mutate: mockDecideMemory, isLoading: false }),
}));

const emailApproval: TApproval = {
  _id: 'ap1',
  user: 'u1',
  kind: 'email',
  title: 'Chase Henderson invoice',
  description: 'Draft ready — send?',
  status: 'pending',
  payload: { to: 'ap@example.com', subject: 'Invoice 1042', body: 'Hi Dana…' },
  createdAt: '2026-08-30T10:00:00.000Z',
};

const memory: TBrainApproval = {
  _id: 'bl1',
  user: 'u1',
  surface: 'imessage',
  direction: 'inbound',
  messageId: 'imessage-1',
  text: 'Signed the $50k Acme deal, closes Friday',
  sender: '+15551234567',
  status: 'awaiting_approval',
  outcome: 'create',
  noteId: 'Acme Deal',
  noteType: 'finance',
  noteContent: '$50k deal with [[Acme]], closing Friday.',
  todoItems: ['Send Acme the countersigned copy'],
  reason: 'new deal entity',
  createdAt: '2026-08-30T11:00:00.000Z',
};

describe('Actions with memory approvals', () => {
  beforeEach(() => {
    mockApprovalsQuery.mockReset();
    mockBrainApprovalsQuery.mockReset();
    mockDecide.mockReset();
    mockDecideMemory.mockReset();
  });

  it('merges memory writes into the queue and approves them through the brain endpoint', () => {
    mockApprovalsQuery.mockReturnValue({ data: [emailApproval], isLoading: false });
    mockBrainApprovalsQuery.mockReturnValue({ data: [memory], isLoading: false });
    render(<Actions />);
    expect(screen.getByText('2 pending')).toBeInTheDocument();
    expect(screen.getByText('Remember: Acme Deal')).toBeInTheDocument();
    expect(screen.getByText('Chase Henderson invoice')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Remember: Acme Deal'));
    expect(screen.getByText('Proposed note · finance')).toBeInTheDocument();
    expect(screen.getByText('$50k deal with [[Acme]], closing Friday.')).toBeInTheDocument();
    expect(screen.getByText('Send Acme the countersigned copy')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(mockDecideMemory).toHaveBeenCalledWith({ brainLogId: 'bl1', decision: 'approve' });
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('rejects a memory write and keeps email approvals on their own mutation', () => {
    mockApprovalsQuery.mockReturnValue({ data: [emailApproval], isLoading: false });
    mockBrainApprovalsQuery.mockReturnValue({ data: [memory], isLoading: false });
    render(<Actions />);
    fireEvent.click(screen.getByText('Remember: Acme Deal'));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(mockDecideMemory).toHaveBeenCalledWith({ brainLogId: 'bl1', decision: 'reject' });

    fireEvent.click(screen.getByText('Chase Henderson invoice'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(mockDecide).toHaveBeenCalledWith({ approvalId: 'ap1', payload: { status: 'approved' } });
  });

  it('shows the empty state when nothing is waiting', () => {
    mockApprovalsQuery.mockReturnValue({ data: [], isLoading: false });
    mockBrainApprovalsQuery.mockReturnValue({ data: [], isLoading: false });
    render(<Actions />);
    expect(screen.getByText(/Nothing is waiting on you/)).toBeInTheDocument();
  });
});
