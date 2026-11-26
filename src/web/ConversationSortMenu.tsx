import { useRef } from 'react';
import type { ConversationSort } from '../shared/types';
import { useInterfaceLanguage } from './interface-language';
import { PanelMenu } from './PanelMenu';
import { Icon } from './primitives';

const options = [
  { value: 'updated_at', label: 'Last updated' },
  { value: 'created_at', label: 'Date created' },
] as const;

export function ConversationSortMenu({
  value,
  onChange,
}: {
  value: ConversationSort;
  onChange: (value: ConversationSort) => void;
}) {
  const { t } = useInterfaceLanguage();
  const menu = useRef<HTMLDetailsElement>(null);
  const selected = options.findIndex((option) => option.value === value);
  const current = t(options[selected]?.label ?? options[0].label);
  return (
    <div
      className="session-sort"
      onBlur={(event) => {
        if (menu.current?.open && !event.currentTarget.contains(event.relatedTarget))
          menu.current.open = false;
      }}
      onKeyDown={(event) => {
        if (!menu.current || event.altKey || event.ctrlKey || event.metaKey) return;
        const { key } = event;
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
        event.preventDefault();
        const items = Array.from(menu.current.querySelectorAll<HTMLButtonElement>('button'));
        const focused = items.findIndex((item) => item === event.target);
        let next = Math.max(0, selected);
        if (key === 'Home') next = 0;
        else if (key === 'End') next = items.length - 1;
        else if (focused >= 0) {
          const step = key === 'ArrowDown' ? 1 : -1;
          next = (focused + step + items.length) % items.length;
        }
        menu.current.open = true;
        items[next]?.focus();
      }}
    >
      <PanelMenu
        label={t('Sort conversations')}
        description={current}
        controller={menu}
        trigger={
          <>
            <span>{current}</span>
            <Icon name="chevron" size={13} />
          </>
        }
      >
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={option.value === value}
            data-close-menu
            onClick={() => onChange(option.value)}
          >
            {t(option.label)}
            {option.value === value && <Icon name="check" size={15} />}
          </button>
        ))}
      </PanelMenu>
    </div>
  );
}
