import { useRecoilValue } from 'recoil';
import { Telescope } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

const DEEP_SPEC = 'hermes-deep';
const DEFAULT_SPEC = 'hermes';

export default function DeepResearchToggle() {
  const localize = useLocalize();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const isDeep = conversation?.spec === DEEP_SPEC;

  /**
   * Full navigation on purpose: the spec query param is only processed on a
   * fresh ChatView mount (useQueryParams runs once per mount), so a client-side
   * route change to the same path would silently keep the previous spec.
   */
  const toggle = () => {
    window.location.assign(`/c/new?spec=${isDeep ? DEFAULT_SPEC : DEEP_SPEC}`);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDeep}
      aria-label={localize('com_ui_deep_research')}
      onClick={toggle}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
        isDeep
          ? 'border-border-heavy bg-surface-active font-medium text-text-primary'
          : 'border-border-light bg-surface-secondary text-text-secondary hover:text-text-primary',
      )}
    >
      <Telescope className="h-4 w-4" aria-hidden="true" />
      <span className="hidden md:inline">{localize('com_ui_deep_research')}</span>
    </button>
  );
}
