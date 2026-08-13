import { useMemo, useState } from 'react';
import { Mail, XCircle, CheckCircle2, FileSpreadsheet, MessageSquareText } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  OGDialogDescription,
} from '@librechat/client';
import type { TApproval, TApprovalKind, TApprovalStatus } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import { useApprovalsQuery, useDecideApprovalMutation } from '~/data-provider';
import { cn, getMessageTimestamp } from '~/utils';
import { useLocalize } from '~/hooks';

type LocalizeFn = ReturnType<typeof useLocalize>;
type LocalizeKey = Parameters<LocalizeFn>[0];

const kindIcons: Record<TApprovalKind, LucideIcon> = {
  email: Mail,
  message: MessageSquareText,
  document: FileSpreadsheet,
};

const kindLabels: Record<TApprovalKind, LocalizeKey> = {
  email: 'com_ui_action_email',
  message: 'com_ui_action_message',
  document: 'com_ui_action_document',
};

const statusLabels: Record<Exclude<TApprovalStatus, 'pending'>, LocalizeKey> = {
  approved: 'com_ui_approved',
  denied: 'com_ui_denied',
};

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

const detailViews: Record<TApprovalKind, ({ approval }: { approval: TApproval }) => JSX.Element> = {
  email: EmailDetail,
  message: MessageDetail,
  document: DocumentDetail,
};

function ActionDialog({
  approval,
  onClose,
  onDecide,
  isDeciding,
}: {
  approval: TApproval;
  onClose: () => void;
  onDecide: (status: 'approved' | 'denied') => void;
  isDeciding: boolean;
}) {
  const localize = useLocalize();
  const Detail = detailViews[approval.kind];
  const timestamp = getMessageTimestamp(approval.createdAt);

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogContent className="flex w-full max-w-xl flex-col p-0" showCloseButton={true}>
        <div className="shrink-0 px-6 pr-12 pt-6">
          <OGDialogTitle className="text-base">{approval.title}</OGDialogTitle>
          <OGDialogDescription className="mt-0.5">
            {[localize(kindLabels[approval.kind]), timestamp?.relative].filter(Boolean).join(' · ')}
          </OGDialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <p className="mb-3 text-sm text-text-secondary">{approval.description}</p>
          <Detail approval={approval} />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-light px-6 py-4">
          {approval.status === 'pending' ? (
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
            <StatusChip status={approval.status} />
          )}
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}

const DECIDED_SHOWN = 4;

export default function Actions() {
  const localize = useLocalize();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: approvals, isLoading } = useApprovalsQuery();
  const decideMutation = useDecideApprovalMutation();

  const ordered = useMemo(() => {
    const pending: TApproval[] = [];
    const decided: TApproval[] = [];
    for (const approval of approvals ?? []) {
      (approval.status === 'pending' ? pending : decided).push(approval);
    }
    return { pending, rows: [...pending, ...decided.slice(0, DECIDED_SHOWN)] };
  }, [approvals]);

  const selected = useMemo(
    () => ordered.rows.find((approval) => approval._id === selectedId) ?? null,
    [ordered.rows, selectedId],
  );

  const handleDecide = (status: 'approved' | 'denied') => {
    if (selected == null) {
      return;
    }
    decideMutation.mutate({ approvalId: selected._id, payload: { status } });
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
          {ordered.rows.map((approval) => {
            const Icon = kindIcons[approval.kind];
            const timestamp = getMessageTimestamp(approval.createdAt);
            const decided = approval.status !== 'pending';
            return (
              <li key={approval._id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(approval._id)}
                  className={cn(
                    '-mx-2 flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-hover',
                    decided && 'opacity-60',
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary">
                    <Icon className="h-4 w-4 text-text-secondary" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {approval.title}
                    </p>
                    <p className="truncate text-xs text-text-tertiary">{approval.description}</p>
                  </div>
                  <StatusChip status={approval.status} />
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
          approval={selected}
          onClose={() => setSelectedId(null)}
          onDecide={handleDecide}
          isDeciding={decideMutation.isLoading}
        />
      )}
    </section>
  );
}
