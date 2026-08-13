import { useNavigate } from 'react-router-dom';
import { MessageCircle, BarChart3 } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type ViewToggleProps = {
  current: 'chat' | 'analytics';
};

export default function ViewToggle({ current }: ViewToggleProps) {
  const localize = useLocalize();
  const navigate = useNavigate();

  const options = [
    {
      key: 'chat' as const,
      label: localize('com_ui_chat'),
      icon: MessageCircle,
      onSelect: () => navigate('/c/new'),
    },
    {
      key: 'analytics' as const,
      label: localize('com_ui_analytics'),
      icon: BarChart3,
      onSelect: () => navigate('/analytics'),
    },
  ];

  return (
    <nav
      aria-label={localize('com_ui_analytics')}
      className="flex items-center gap-0.5 rounded-full border border-border-light bg-surface-secondary p-0.5"
    >
      {options.map(({ key, label, icon: Icon, onSelect }) => {
        const isActive = current === key;
        return (
          <button
            key={key}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={isActive ? undefined : onSelect}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors',
              isActive
                ? 'bg-surface-primary font-medium text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
