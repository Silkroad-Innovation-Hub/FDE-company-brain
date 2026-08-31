import React from 'react';
import '@testing-library/jest-dom';
import type { TWorkflowPolicy } from 'librechat-data-provider';
import { render, screen, fireEvent } from 'test/layout-test-utils';
import { Workflows } from '../Guardrails';

const mockPoliciesQuery = jest.fn();
const mockUpdate = jest.fn();
const mockRun = jest.fn();

jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useWorkflowPoliciesQuery: () => mockPoliciesQuery(),
  useUpdateWorkflowPolicyMutation: () => ({ mutate: mockUpdate, isLoading: false }),
  useRunWorkflowMutation: () => ({ mutate: mockRun, isLoading: false }),
}));

const policies: TWorkflowPolicy[] = [
  {
    workflow: 'brief',
    canAutoSend: false,
    enabled: true,
    autoSend: false,
    graduatedAt: null,
    lastRunAt: new Date().toISOString(),
    lastRunSummary: '3 to-dos, 1 approval',
  },
  {
    workflow: 'chase',
    canAutoSend: true,
    enabled: true,
    autoSend: false,
    graduatedAt: null,
    lastRunAt: null,
    lastRunSummary: null,
  },
];

describe('Workflows', () => {
  beforeEach(() => {
    mockPoliciesQuery.mockReset();
    mockUpdate.mockReset();
    mockRun.mockReset();
  });

  it('shows a skeleton while loading', () => {
    mockPoliciesQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<Workflows />);
    expect(screen.getByLabelText('Workflows').querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('lists both workflows with last-run state and only chase has auto-send', () => {
    mockPoliciesQuery.mockReturnValue({ data: policies, isLoading: false, isError: false });
    render(<Workflows />);
    expect(screen.getByText('Morning brief')).toBeInTheDocument();
    expect(screen.getByText('Invoice chase')).toBeInTheDocument();
    expect(screen.getByText('Never run')).toBeInTheDocument();
    expect(screen.getByLabelText('Invoice chase auto-send')).toBeInTheDocument();
    expect(screen.queryByLabelText('Morning brief auto-send')).toBeNull();
  });

  it('disabling a workflow calls the mutation directly', () => {
    mockPoliciesQuery.mockReturnValue({ data: policies, isLoading: false, isError: false });
    render(<Workflows />);
    fireEvent.click(screen.getByLabelText('Morning brief enabled'));
    expect(mockUpdate).toHaveBeenCalledWith(
      { workflow: 'brief', payload: { enabled: false } },
      expect.any(Object),
    );
  });

  it('graduating to auto-send asks for confirmation first', () => {
    mockPoliciesQuery.mockReturnValue({ data: policies, isLoading: false, isError: false });
    render(<Workflows />);
    fireEvent.click(screen.getByLabelText('Invoice chase auto-send'));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Turn on auto-send for Invoice chase?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on auto-send' }));
    expect(mockUpdate).toHaveBeenCalledWith(
      { workflow: 'chase', payload: { autoSend: true } },
      expect.any(Object),
    );
  });

  it('run now triggers the workflow', () => {
    mockPoliciesQuery.mockReturnValue({ data: policies, isLoading: false, isError: false });
    render(<Workflows />);
    fireEvent.click(screen.getByLabelText('Run Morning brief now'));
    expect(mockRun).toHaveBeenCalledWith('brief', expect.any(Object));
  });

  it('shows an error state', () => {
    mockPoliciesQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<Workflows />);
    expect(screen.getByText('Workflows could not be loaded')).toBeInTheDocument();
  });
});
