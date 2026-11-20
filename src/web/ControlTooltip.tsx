import { useEffect, useRef } from 'react';

const hoverDelay = 300;
const exitDelay = 160;
const margin = 8;
const gap = 5;

/** One tooltip for the workspace, positioned outside scrollable toolbars and cards. */
export function ControlTooltip() {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tooltip = element.current!;
    const workspace = tooltip.closest<HTMLElement>('.app')!;
    let control: HTMLElement | null = null;
    let opening: ReturnType<typeof setTimeout> | undefined;
    let closing: ReturnType<typeof setTimeout>;

    const cancelOpening = () => {
      clearTimeout(opening);
      opening = undefined;
    };
    const hide = () => {
      cancelOpening();
      clearTimeout(closing);
      tooltip.hidden = true;
      control = null;
    };
    const find = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
    const show = (target: HTMLElement, delay: number) => {
      clearTimeout(closing);
      if (control === target && (!tooltip.hidden || (opening !== undefined && delay > 0))) return;
      hide();
      control = target;
      opening = setTimeout(() => {
        opening = undefined;
        const label = target.dataset.tooltip || target.getAttribute('aria-label');
        if (!label || !target.getClientRects().length || target.closest('[inert]')) {
          hide();
          return;
        }
        tooltip.textContent = label;
        tooltip.hidden = false;
        const bounds = target.getBoundingClientRect();
        const width = tooltip.offsetWidth;
        const height = tooltip.offsetHeight;
        const below = bounds.bottom + gap;
        const above = bounds.top - height - gap;
        const top = below + height <= innerHeight - margin ? below : above;
        tooltip.style.top = Math.max(margin, top) + 'px';
        tooltip.style.left =
          Math.max(
            margin,
            Math.min(bounds.left + (bounds.width - width) / 2, innerWidth - width - margin),
          ) + 'px';
      }, delay);
    };
    const pointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (event.target instanceof Node && tooltip.contains(event.target)) {
        clearTimeout(closing);
        return;
      }
      const target = find(event.target);
      if (target) show(target, hoverDelay);
    };
    const pointerOut = (event: PointerEvent) => {
      if (
        event.pointerType === 'touch' ||
        !control ||
        !(event.target instanceof Node) ||
        (!control.contains(event.target) && !tooltip.contains(event.target))
      )
        return;
      const next = event.relatedTarget;
      if (next instanceof Node && (control.contains(next) || tooltip.contains(next))) return;
      if (control.matches(':focus-visible')) return;
      cancelOpening();
      clearTimeout(closing);
      closing = setTimeout(hide, exitDelay);
    };
    const focusIn = (event: FocusEvent) => {
      const target = find(event.target);
      if (target?.matches(':focus-visible')) show(target, 0);
    };
    const focusOut = (event: FocusEvent) => {
      if (find(event.target) === control && !control?.matches(':hover')) hide();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };

    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    workspace.addEventListener('pointerover', pointerOver, options);
    workspace.addEventListener('pointerout', pointerOut, options);
    workspace.addEventListener('focusin', focusIn, options);
    workspace.addEventListener('focusout', focusOut, options);
    workspace.addEventListener('pointerdown', hide, options);
    window.addEventListener('keydown', escape, { ...options, capture: true });
    window.addEventListener('scroll', hide, { ...options, capture: true, passive: true });
    window.addEventListener('resize', hide, options);
    return () => {
      listeners.abort();
      hide();
    };
  }, []);
  return <div className="control-tooltip" role="tooltip" aria-hidden="true" ref={element} hidden />;
}
