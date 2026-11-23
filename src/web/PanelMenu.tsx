import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/** Native disclosure keeps Enter/Space usable; popup dismissals restore the trigger. */
export function PanelMenu({
  label,
  trigger,
  description,
  children,
  controller,
  className = '',
  disabled = false,
  iconOnly = false,
  floating = false,
}: {
  label: string;
  trigger: ReactNode;
  description?: string;
  children: ReactNode;
  controller?: RefObject<HTMLDetailsElement | null>;
  className?: string;
  disabled?: boolean;
  iconOnly?: boolean;
  floating?: boolean;
}) {
  const local = useRef<HTMLDetailsElement>(null);
  const ref = controller ?? local;
  const content = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const disclosure = ref.current;
    const popup = content.current;
    const trigger = disclosure?.querySelector('summary');
    const place = () => {
      if (!floating || !trigger || !popup) return;
      const bounds = trigger.getBoundingClientRect();
      if (
        !trigger.checkVisibility() ||
        trigger.closest('[inert]') ||
        bounds.bottom < 0 ||
        bounds.top > window.innerHeight
      ) {
        if (disclosure) disclosure.open = false;
        return;
      }
      const margin = 8;
      const gap = 4;
      const width = popup.offsetWidth;
      const below = innerHeight - bounds.bottom - gap - margin;
      const above = bounds.top - gap - margin;
      const height = popup.scrollHeight + 2;
      const down = height <= below || below >= above;
      const maxHeight = Math.max(0, down ? below : above);
      popup.style.maxHeight = maxHeight + 'px';
      popup.style.left =
        Math.max(margin, Math.min(bounds.right - width, innerWidth - width - margin)) + 'px';
      popup.style.top =
        (down ? bounds.bottom + gap : bounds.top - gap - Math.min(height, maxHeight)) + 'px';
    };
    if (floating) {
      popup?.showPopover();
      place();
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
    }
    const outside = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        ref.current.open = false;
        trigger?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      if (floating) {
        window.removeEventListener('resize', place);
        window.removeEventListener('scroll', place, true);
        if (popup?.matches(':popover-open')) popup.hidePopover();
      }
    };
  }, [floating, open, ref]);
  return (
    <details
      className={'panel-menu ' + className}
      ref={ref}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        role="button"
        aria-label={label}
        data-tooltip={description ?? (iconOnly ? '' : undefined)}
        aria-description={description}
        aria-expanded={open}
        aria-disabled={disabled || undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        {trigger}
      </summary>
      <div
        ref={content}
        popover={floating ? 'manual' : undefined}
        className="panel-menu-content"
        role="dialog"
        aria-label={label}
        onClick={(event) => {
          if ((event.target as Element).closest('[data-close-menu]') && ref.current) {
            ref.current.open = false;
            ref.current.querySelector('summary')?.focus();
          }
        }}
      >
        {children}
      </div>
    </details>
  );
}
