import { useEffect, type RefObject } from 'react';

/** Drawer focus belongs to the visible panel; closing it never interrupts a task. */
export function usePanelFocus(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  close: () => void,
  fallback: string,
) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary,a[href]',
        ) ?? [],
      ).filter((element) => element.checkVisibility());
    controls()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      // Portaled confirmations own their keyboard handling while focused.
      if (!ref.current?.contains(document.activeElement)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key !== 'Tab') return;
      const items = controls();
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && (index < 0 || index === items.length - 1)) {
        event.preventDefault();
        items[0]?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      queueMicrotask(() => {
        if (previous?.isConnected && previous !== document.body && !previous.closest('[inert]'))
          previous.focus();
        else document.querySelector<HTMLElement>(fallback)?.focus();
      });
    };
  }, [ref, active, close, fallback]);
}
