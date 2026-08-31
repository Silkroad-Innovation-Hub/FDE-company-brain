import { useMemo, useState } from 'react';
import {
  Mail,
  Brain,
  XCircle,
  CheckCircle2,
  FileSpreadsheet,
  MessageSquareText,
} from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  OGDialogDescription,
} from '@librechat/client';
import type {
  TApproval,
  TApprovalKind,
  TApprovalStatus,
  TBrainApproval,
} from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import {
  useApprovalsQuery,
  useDecideApprovalMutation,
  useBrainApprovalsQuery,
  useDecideBrainApprovalMutation,
} from '~/data-provider';
import { cn, getMessageTimestamp } from '~/utils';
import { useLocalize } from '~/hooks';

type LocalizeFn = ReturnType<typeof useLocalize>;
type LocalizeKey = Parameters<LocalizeFn>[0];

type ActionKind = TApprovalKind | 'memory';

/** One row in the queue: an outbound approval or a proposed memory write. */
type ActionItem = {
  id: string;
  kind: ActionKind;
  title: string;
  description: string;
  status: TApprovalStatus;
  createdAt?: string;
  approval?: TApproval;
  memory?: TBrainApproval;
};

const kindIcons: Record<ActionKind, LucideIcon> = {
  email: Mail,
  message: MessageSquareText,
  document: FileSpreadsheet,
  memory: Brain,
};

const kindLabels: Record<ActionKind, LocalizeKey> = {
  email: 'com_ui_action_email',
  message: 'com_ui_action_message',
  document: 'com_ui_action_document',
  memory: 'com_ui_action_memory',
};

const statusLabels: Record<Exclude<TApprovalStatus, 'pending'>, LocalizeKey> = {
  approved: 'com_ui_approved',
  denied: 'com_ui_denied',
};

const surfaceLabels: Record<string, string> = {
  imessage: 'iMessage',
  email: 'email',
  chat: 'chat',
};

function memoryOutcome(entry: TBrainApproval, localize: LocalizeFn): string {
  if (entry.outcome === 'merge') {
    return localize('com_ui_memory_outcome_merge');
  }
  if (entry.outcome === 'create') {
    return localize('com_ui_memory_outcome_create');
  }
  return localize('com_ui_memory_outcome_todos');
}

function memoryProvenance(entry: TBrainApproval, localize: LocalizeFn): string {
  const surface = surfaceLabels[entry.surface] ?? entry.surface;
  const who = entry.sender ? `${surface} · ${entry.sender}` : surface;
  return localize('com_ui_memory_from', { 0: who });
}

function toMemoryItem(entry: TBrainApproval, localize: LocalizeFn): ActionItem {
  const hasNote = Boolean(entry.noteId && entry.noteContent);
  const title = hasNote
    ? localize('com_ui_memory_remember', { 0: entry.noteId ?? '' })
    : localize('com_ui_memory_add_todos');
  const description = [
    memoryOutcome(entry, localize),
    entry.reason,
    memoryProvenance(entry, localize),
  ]
    .filter((part) => part != null && part !== '')
    .join(' · ');
  return {
    id: `memory:${entry._id}`,
    kind: 'memory',
    title,
    description,
    status: 'pending',
    createdAt: entry.createdAt,
    memory: entry,
  };
}

function toApprovalItem(approval: TApproval): ActionItem {
  return {
    id: `approval:${approval._id}`,
    kind: approval.kind,
    title: approval.title,
    description: approval.description,
    status: approval.status,
    createdAt: approval.createdAt,
    approval,
  };
}

function StatusChip({ status }: { status: TApprovalStatus }) {
  const localize = useLocalize();
  if (status === 'pending') {
    return (
      <span className="shrink-0 rounded-full border border-border-medium px-2 py-0.5 text-xs font-medium text-text-secondary">
        {localize('com_ui_needs_review')}
      </span>
    );
  }
  const Icon = status === 'approved' ? CheckCircle2 : XCircle;
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-text-tertiary">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {localize(statusLabels[status])}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value?: string }) {
  if (value == null || value === '') {
    return null;
  }
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-16 shrink-0 text-text-tertiary">{label}</span>
      <span className="min-w-0 break-words text-text-primary">{value}</span>
    </div>
  );
}

function EmailDetail({ approval }: { approval: TApproval }) {
  const localize = useLocalize();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-xl bg-surface-secondary p-4">
        <MetaRow label={localize('com_ui_email_to')} value={approval.payload.to} />
        <MetaRow label={localize('com_ui_email_cc')} value={approval.payload.cc} />
        <MetaRow label={localize('com_ui_email_subject')} value={approval.payload.subject} />
      </div>
      <div className="whitespace-pre-wrap rounded-xl border border-border-light p-4 text-sm leading-relaxed text-text-primary">
        {approval.payload.body}
      </div>
    </div>
  );
}

function MessageDetail({ approval }: { approval: TApproval }) {
  const localize = useLocalize();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-xl bg-surface-secondary p-4">
        <MetaRow label={localize('com_ui_msg_channel')} value={approval.payload.channel} />
        <MetaRow label={localize('com_ui_email_to')} value={approval.payload.recipient} />
      </div>
      <div className="max-w-[85%] self-start whitespace-pre-wrap rounded-2xl rounded-bl-md border border-border-light bg-surface-secondary px-4 py-3 text-sm leading-relaxed text-text-primary">
        {approval.payload.text}
      </div>
    </div>
  );
}

function DocumentDetail({ approval }: { approval: TApproval }) {
  const localize = useLocalize();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-xl bg-surface-secondary p-4">
        <MetaRow label={localize('com_ui_document')} value={approval.payload.document} />
      </div>
      {approval.payload.summary != null && (
        <p className="text-sm leading-relaxed text-text-secondary">{approval.payload.summary}</p>
      )}
      {(approval.payload.changes?.length ?? 0) > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border-light">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-light text-xs uppercase tracking-wide text-text-tertiary">
                <th className="px-4 py-2.5 font-medium">{localize('com_ui_change_field')}</th>
                <th className="px-4 py-2.5 font-medium">{localize('com_ui_change_before')}</th>
                <th className="px-4 py-2.5 font-medium">{localize('com_ui_change_after')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {(approval.payload.changes ?? []).map((change) => (
                <tr key={change.field}>
                  <td className="px-4 py-2.5 text-text-secondary">{change.field}</td>
                  <td className="px-4 py-2.5 text-text-tertiary line-through decoration-border-heavy">
                    {change.before}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-text-primary">{change.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MemoryDetail({ entry }: { entry: TBrainApproval }) {
  const localize = useLocalize();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-xl bg-surface-secondary p-4">
        <MetaRow label={localize('com_ui_memory_source')} value={entry.text} />
      </div>
      {entry.noteContent != null && entry.noteContent !== '' && (
        <div>
          <p className="mb-1.5 text-xs uppercase tracking-wide text-text-tertiary">
            {localize('com_ui_memory_proposed_note')}
            {entry.noteType ? ` · ${entry.noteType}` : ''}
          </p>
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border-light p-4 font-mono text-xs leading-relaxed text-text-primary">
            {entry.noteContent}
          </div>
        </div>
      )}
      {(entry.todoItems?.length ?? 0) > 0 && (
        <div>
          <p className="mb-1.5 text-xs uppercase tracking-wide text-text-tertiary">
            {localize('com_ui_memory_todo_items')}
          </p>
          <ul className="flex flex-col gap-1 rounded-xl border border-border-light p-4 text-sm text-text-primary">
            {(entry.todoItems ?? []).map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="text-text-tertiary">
                  –
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ItemDetail({ item }: { item: ActionItem }) {
  if (item.memory != null) {
    return <MemoryDetail entry={item.memory} />;
  }
  if (item.approval == null) {
    return null;
  }
  if (item.approval.kind === 'email') {
    return <EmailDetail approval={item.approval} />;
  }
  if (item.approval.kind === 'message') {
    return <MessageDetail approval={item.approval} />;
  }
  return <DocumentDetail approval={item.approval} />;
}

function ActionDialog({
  item,
  onClose,
  onDecide,
  isDeciding,
}: {
  item: ActionItem;
  onClose: () => void;
  onDecide: (status: 'approved' | 'denied') => void;
  isDeciding: boolean;
}) {
  const localize = useLocalize();
  const timestamp = getMessageTimestamp(item.createdAt);

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogContent className="flex w-full max-w-xl flex-col p-0" showCloseButton={true}>
        <div className="shrink-0 px-6 pr-12 pt-6">
          <OGDialogTitle className="text-base">{item.title}</OGDialogTitle>
          <OGDialogDescription className="mt-0.5">
            {[localize(kindLabels[item.kind]), timestamp?.relative].filter(Boolean).join(' · ')}
          </OGDialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <p className="mb-3 text-sm text-text-secondary">{item.description}</p>
          <ItemDetail item={item} />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-light px-6 py-4">
          {item.status === 'pending' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={isDeciding}
                onClick={() => onDecide('denied')}
              >
                <XCircle className="h-4 w-4" aria-hidden="true" />
                {localize('com_ui_deny')}
              </Button>
              <Button
                variant="submit"
                size="sm"
                disabled={isDeciding}
                onClick={() => onDecide('approved')}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {localize('com_ui_approve')}
              </Button>
            </>
          ) : (
            <StatusChip status={item.status} />
          )}
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}

const DECIDED_SHOWN = 4;

function byNewest(a: ActionItem, b: ActionItem): number {
  return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
}

export default function Actions() {
  const localize = useLocalize();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: approvals, isLoading: approvalsLoading } = useApprovalsQuery();
  const { data: memories, isLoading: memoriesLoading } = useBrainApprovalsQuery();
  const decideMutation = useDecideApprovalMutation();
  const decideMemoryMutation = useDecideBrainApprovalMutation();
  const isLoading = approvalsLoading || memoriesLoading;

  const ordered = useMemo(() => {
    const pending: ActionItem[] = (memories ?? []).map((entry) => toMemoryItem(entry, localize));
    const decided: ActionItem[] = [];
    for (const approval of approvals ?? []) {
      (approval.status === 'pending' ? pending : decided).push(toApprovalItem(approval));
    }
    pending.sort(byNewest);
    return { pending, rows: [...pending, ...decided.slice(0, DECIDED_SHOWN)] };
  }, [approvals, memories, localize]);

  const selected = useMemo(
    () => ordered.rows.find((item) => item.id === selectedId) ?? null,
    [ordered.rows, selectedId],
  );

  const handleDecide = (status: 'approved' | 'denied') => {
    if (selected == null) {
      return;
    }
    if (selected.memory != null) {
      decideMemoryMutation.mutate({
        brainLogId: selected.memory._id,
        decision: status === 'approved' ? 'approve' : 'reject',
      });
    } else if (selected.approval != null) {
      decideMutation.mutate({ approvalId: selected.approval._id, payload: { status } });
    }
    setSelectedId(null);
  };

  return (
    <section
      aria-label={localize('com_ui_awaiting_approval')}
      className="flex flex-col gap-3 rounded-2xl border border-border-light bg-surface-primary p-5 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-primary">
          {localize('com_ui_awaiting_approval')}
        </h2>
        {ordered.pending.length > 0 && (
          <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs font-medium text-text-secondary">
            {localize('com_ui_pending_count', { 0: String(ordered.pending.length) })}
          </span>
        )}
      </div>
      {isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-10 animate-pulse rounded-lg bg-surface-secondary" />
          ))}
        </div>
      )}
      {!isLoading && ordered.rows.length === 0 && (
        <p className="py-2 text-sm text-text-tertiary">{localize('com_ui_actions_empty')}</p>
      )}
      {!isLoading && ordered.rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-light">
          {ordered.rows.map((item) => {
            const Icon = kindIcons[item.kind];
            const timestamp = getMessageTimestamp(item.createdAt);
            const decided = item.status !== 'pending';
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    '-mx-2 flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-hover',
                    decided && 'opacity-60',
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary">
                    <Icon className="h-4 w-4 text-text-secondary" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">{item.title}</p>
                    <p className="truncate text-xs text-text-tertiary">{item.description}</p>
                  </div>
                  <StatusChip status={item.status} />
                  {timestamp != null && (
                    <span className="hidden w-20 shrink-0 text-right text-xs text-text-tertiary sm:block">
                      {timestamp.relative}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selected != null && (
        <ActionDialog
          item={selected}
          onClose={() => setSelectedId(null)}
          onDecide={handleDecide}
          isDeciding={decideMutation.isLoading || decideMemoryMutation.isLoading}
        />
      )}
    </section>
  );
}
