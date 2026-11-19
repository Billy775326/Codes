import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

/** Native disclosure keeps Enter/Space usable; popup dismissals restore the trigger. */
export function PanelMenu({
  label,
  trigger,
  children,
  controller,
  className = '',
  disabled = false,
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  controller?: RefObject<HTMLDetailsElement | null>;
  className?: string;
  disabled?: boolean;
}) {
  const local = useRef<HTMLDetailsElement>(null);
  const ref = controller ?? local;
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) {
        event.preventDefault();
        event.stopPropagation();
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [ref]);
  return (
    <details className={'panel-menu ' + className} ref={ref}>
      <summary
        role="button"
        aria-label={label}
        title={label}
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
          if ((event.target as Element).closest('[data-close-menu]') && ref.current)
            ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
