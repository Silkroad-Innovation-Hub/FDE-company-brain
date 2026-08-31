import { useState } from 'react';
import { Play, Sunrise, Receipt } from 'lucide-react';
import {
  Button,
  Switch,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  OGDialogDescription,
  useToastContext,
} from '@librechat/client';
import type { TWorkflowPolicy, TWorkflowName } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import {
  useWorkflowPoliciesQuery,
  useUpdateWorkflowPolicyMutation,
  useRunWorkflowMutation,
} from '~/data-provider';
import { getMessageTimestamp } from '~/utils';
import { useLocalize } from '~/hooks';

type LocalizeFn = ReturnType<typeof useLocalize>;
type LocalizeKey = Parameters<LocalizeFn>[0];

const workflowIcons: Record<TWorkflowName, LucideIcon> = {
  brief: Sunrise,
  chase: Receipt,
};

const workflowLabels: Record<TWorkflowName, LocalizeKey> = {
  brief: 'com_ui_workflow_brief',
  chase: 'com_ui_workflow_chase',
};

const workflowHints: Record<TWorkflowName, LocalizeKey> = {
  brief: 'com_ui_workflow_brief_hint',
  chase: 'com_ui_workflow_chase_hint',
};

function GraduateDialog({
  workflow,
  onCancel,
  onConfirm,
}: {
  workflow: TWorkflowName;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const localize = useLocalize();
  return (
    <OGDialog open onOpenChange={(open) => !open && onCancel()}>
      <OGDialogContent className="w-full max-w-md p-6" showCloseButton={false}>
        <OGDialogTitle className="text-base">
          {localize('com_ui_workflow_graduate_title', { 0: localize(workflowLabels[workflow]) })}
        </OGDialogTitle>
        <OGDialogDescription className="mt-2 text-sm leading-relaxed text-text-secondary">
          {localize('com_ui_workflow_graduate_body')}
        </OGDialogDescription>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {localize('com_ui_cancel')}
          </Button>
          <Button variant="submit" size="sm" onClick={onConfirm}>
            {localize('com_ui_workflow_graduate_confirm')}
          </Button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}

function LastRun({ policy }: { policy: TWorkflowPolicy }) {
  const localize = useLocalize();
  const timestamp = policy.lastRunAt ? getMessageTimestamp(policy.lastRunAt) : null;
  if (timestamp == null) {
    return (
      <span className="text-xs text-text-tertiary">{localize('com_ui_workflow_never_ran')}</span>
    );
  }
  return (
    <span
      className="truncate text-xs text-text-tertiary"
      title={policy.lastRunSummary ?? undefined}
    >
      {localize('com_ui_workflow_last_run', { 0: timestamp.relative })}
      {policy.lastRunSummary ? ` · ${policy.lastRunSummary}` : ''}
    </span>
  );
}

function WorkflowRow({
  policy,
  onToggle,
  onRun,
  isRunning,
}: {
  policy: TWorkflowPolicy;
  onToggle: (field: 'enabled' | 'autoSend', value: boolean) => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  const localize = useLocalize();
  const Icon = workflowIcons[policy.workflow];
  const label = localize(workflowLabels[policy.workflow]);
  const graduated = policy.graduatedAt ? getMessageTimestamp(policy.graduatedAt) : null;
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary">
        <Icon className="h-4 w-4 text-text-secondary" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="truncate text-xs text-text-tertiary">
          {localize(workflowHints[policy.workflow])}
        </p>
        <LastRun policy={policy} />
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <span>{localize('com_ui_workflow_enabled')}</span>
          <Switch
            aria-label={localize('com_ui_workflow_enabled_aria', { 0: label })}
            checked={policy.enabled}
            onCheckedChange={(value) => onToggle('enabled', value)}
          />
        </label>
        {policy.canAutoSend && (
          <label className="flex flex-col items-end gap-0.5 text-xs text-text-secondary">
            <span className="flex items-center gap-2">
              <span>{localize('com_ui_workflow_auto_send')}</span>
              <Switch
                aria-label={localize('com_ui_workflow_auto_send_aria', { 0: label })}
                checked={policy.autoSend}
                disabled={!policy.enabled}
                onCheckedChange={(value) => onToggle('autoSend', value)}
              />
            </span>
            {policy.autoSend && graduated != null && (
              <span className="text-[11px] text-text-tertiary">
                {localize('com_ui_workflow_graduated_on', { 0: graduated.relative })}
              </span>
            )}
          </label>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={isRunning || !policy.enabled}
          onClick={onRun}
          aria-label={localize('com_ui_workflow_run_now_aria', { 0: label })}
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          {isRunning ? localize('com_ui_workflow_running') : localize('com_ui_workflow_run_now')}
        </Button>
      </div>
    </li>
  );
}

export default function Workflows() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: policies, isLoading, isError } = useWorkflowPoliciesQuery();
  const updateMutation = useUpdateWorkflowPolicyMutation();
  const runMutation = useRunWorkflowMutation();
  const [graduating, setGraduating] = useState<TWorkflowName | null>(null);
  const [running, setRunning] = useState<TWorkflowName | null>(null);

  const update = (workflow: TWorkflowName, payload: { enabled?: boolean; autoSend?: boolean }) =>
    updateMutation.mutate(
      { workflow, payload },
      {
        onError: () =>
          showToast({ message: localize('com_ui_workflow_update_failed'), status: 'error' }),
      },
    );

  const handleToggle = (workflow: TWorkflowName, field: 'enabled' | 'autoSend', value: boolean) => {
    if (field === 'autoSend' && value) {
      setGraduating(workflow);
      return;
    }
    update(workflow, { [field]: value });
  };

  const handleRun = (workflow: TWorkflowName) => {
    setRunning(workflow);
    const label = localize(workflowLabels[workflow]);
    runMutation.mutate(workflow, {
      onSuccess: () =>
        showToast({
          message: localize('com_ui_workflow_run_started', { 0: label }),
          status: 'success',
        }),
      onError: () =>
        showToast({
          message: localize('com_ui_workflow_run_failed', { 0: label }),
          status: 'error',
        }),
      onSettled: () => setRunning(null),
    });
  };

  return (
    <section
      aria-label={localize('com_ui_workflows')}
      className="flex flex-col gap-3 rounded-2xl border border-border-light bg-surface-primary p-5 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-primary">{localize('com_ui_workflows')}</h2>
        <span className="text-xs text-text-tertiary">{localize('com_ui_workflows_hint')}</span>
      </div>
      {isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1].map((row) => (
            <div key={row} className="h-12 animate-pulse rounded-lg bg-surface-secondary" />
          ))}
        </div>
      )}
      {!isLoading && isError && (
        <p className="py-2 text-sm text-text-tertiary">{localize('com_ui_workflow_error')}</p>
      )}
      {!isLoading && !isError && (
        <ul className="flex flex-col divide-y divide-border-light">
          {(policies ?? []).map((policy) => (
            <WorkflowRow
              key={policy.workflow}
              policy={policy}
              onToggle={(field, value) => handleToggle(policy.workflow, field, value)}
              onRun={() => handleRun(policy.workflow)}
              isRunning={running === policy.workflow}
            />
          ))}
        </ul>
      )}
      {graduating != null && (
        <GraduateDialog
          workflow={graduating}
          onCancel={() => setGraduating(null)}
          onConfirm={() => {
            update(graduating, { autoSend: true });
            setGraduating(null);
          }}
        />
      )}
    </section>
  );
}
