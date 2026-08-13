import type { ReactNode } from 'react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type PanelProps = {
  title: string;
  children: ReactNode;
  isSample?: boolean;
  className?: string;
};

export default function Panel({ title, children, isSample = false, className }: PanelProps) {
  const localize = useLocalize();
  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-border-light bg-surface-primary p-5 shadow-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-primary">{title}</h2>
        {isSample && (
          <span className="rounded-full border border-border-medium px-2 py-0.5 text-xs text-text-tertiary">
            {localize('com_ui_sample_data')}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
