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
}: {
  label: string;
  trigger: ReactNode;
  description?: string;
  children: ReactNode;
  controller?: RefObject<HTMLDetailsElement | null>;
  className?: string;
  disabled?: boolean;
  iconOnly?: boolean;
}) {
  const local = useRef<HTMLDetailsElement>(null);
  const ref = controller ?? local;
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
      }
    };
    // A slash command can focus the popup before the native toggle event is delivered.
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [ref]);
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
