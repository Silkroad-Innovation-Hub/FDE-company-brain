import { useMemo, useState } from 'react';
import { useRecoilValue } from 'recoil';
import * as Ariakit from '@ariakit/react';
import { DropdownPopup } from '@librechat/client';
import { Check, ChevronDown, Brain, Telescope, MessagesSquare } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import type { LucideIcon } from 'lucide-react';
import type { TModelSpec } from 'librechat-data-provider';
import type { MenuItemProps } from '~/common';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import { useGetConversation, useNewConvo, useLocalize } from '~/hooks';
import useSelectMention from '~/hooks/Input/useSelectMention';
import { cn } from '~/utils';
import store from '~/store';

interface Mode {
  spec: string;
  labelKey: TranslationKeys;
  descriptionKey: TranslationKeys;
  Icon: LucideIcon;
}

const MODES: Mode[] = [
  {
    spec: 'silkroad',
    labelKey: 'com_ui_mode_chat',
    descriptionKey: 'com_ui_mode_chat_desc',
    Icon: MessagesSquare,
  },
  {
    spec: 'silkroad-brain',
    labelKey: 'com_ui_mode_brain_search',
    descriptionKey: 'com_ui_mode_brain_search_desc',
    Icon: Brain,
  },
  {
    spec: 'silkroad-deep',
    labelKey: 'com_ui_deep_research',
    descriptionKey: 'com_ui_deep_research_desc',
    Icon: Telescope,
  },
];

export default function ModeSelector() {
  const localize = useLocalize();
  const [isOpen, setIsOpen] = useState(false);
  const { newConversation } = useNewConvo();
  const getConversation = useGetConversation(0);
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const activeSpec = useRecoilValue(store.conversationSpecByIndex(0));

  const modelSpecs = useMemo(
    () => startupConfig?.modelSpecs?.list ?? [],
    [startupConfig?.modelSpecs?.list],
  );
  const specsByName = useMemo(
    () => new Map<string, TModelSpec>(modelSpecs.map((spec) => [spec.name, spec])),
    [modelSpecs],
  );
  const modes = useMemo(() => MODES.filter((mode) => specsByName.has(mode.spec)), [specsByName]);

  const { onSelectSpec } = useSelectMention({
    modelSpecs,
    getConversation,
    newConversation,
    endpointsConfig: endpointsConfig ?? {},
    returnHandlers: true,
  });

  if (modes.length < 2) {
    return null;
  }

  const currentMode =
    modes.find((mode) => mode.spec === activeSpec) ??
    modes.find((mode) => mode.spec === MODES[0].spec) ??
    modes[0];
  const CurrentIcon = currentMode.Icon;

  const items: MenuItemProps[] = modes.map(({ spec, labelKey, descriptionKey, Icon }) => ({
    hideOnClick: true,
    onClick: () => {
      if (spec !== currentMode.spec) {
        onSelectSpec?.(specsByName.get(spec));
      }
    },
    render: (props) => (
      <div {...props} role="menuitemradio" aria-checked={spec === currentMode.spec}>
        <div className="flex items-center gap-3">
          <Icon className="icon-md shrink-0 text-text-secondary" aria-hidden="true" />
          <div className="flex flex-col items-start">
            <span className="text-sm font-medium text-text-primary">{localize(labelKey)}</span>
            <span className="text-xs text-text-secondary">{localize(descriptionKey)}</span>
          </div>
        </div>
        <Check
          className={cn('icon-sm shrink-0', spec === currentMode.spec ? 'visible' : 'invisible')}
          aria-hidden="true"
        />
      </div>
    ),
  }));

  const trigger = (
    <Ariakit.MenuButton
      id="mode-selector-button"
      aria-label={localize('com_ui_mode_selector')}
      className={cn(
        'flex items-center gap-1.5 rounded-full border border-border-light px-3 py-1.5 text-sm transition-colors duration-theme-fast',
        'text-text-secondary hover:bg-surface-composer-hover hover:text-text-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-opacity-50',
        isOpen && 'bg-surface-composer-hover text-text-primary',
      )}
    >
      <CurrentIcon className="h-4 w-4" aria-hidden="true" />
      <span className="whitespace-nowrap font-medium">{localize(currentMode.labelKey)}</span>
      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
    </Ariakit.MenuButton>
  );

  return (
    <DropdownPopup
      itemClassName="flex w-full cursor-pointer items-center justify-between gap-6 rounded-lg px-2 py-1.5 hover:bg-surface-hover"
      menuId="mode-selector-menu"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      modal={true}
      unmountOnHide={true}
      trigger={trigger}
      items={items}
    />
  );
}
