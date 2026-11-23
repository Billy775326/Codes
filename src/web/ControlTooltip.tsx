import { useEffect, useRef } from 'react';

const hoverDelay = 300;
const exitDelay = 160;
const margin = 8;
const gap = 5;

/** One tooltip shared by sign-in, workspace controls, and portaled dialogs. */
export function ControlTooltip() {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tooltip = element.current!;
    let control: HTMLElement | null = null;
    let opening: ReturnType<typeof setTimeout> | undefined;
    let closing: ReturnType<typeof setTimeout> | undefined;
    const labels = new MutationObserver(() => {
      if (control && !tooltip.hidden) render(control);
    });

    const cancelOpening = () => {
      clearTimeout(opening);
      opening = undefined;
    };
    const cancelClosing = () => {
      clearTimeout(closing);
      closing = undefined;
    };
    const hide = () => {
      labels.disconnect();
      cancelOpening();
      cancelClosing();
      if (!tooltip.hidden) tooltip.hidden = true;
      control = null;
    };
    const find = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
    const overHint = (event: PointerEvent) => {
      if (tooltip.hidden) return false;
      const { left, right, top, bottom } = tooltip.getBoundingClientRect();
      return (
        event.clientX >= left &&
        event.clientX <= right &&
        event.clientY >= top &&
        event.clientY <= bottom
      );
    };
    const scheduleClose = () => {
      if (closing === undefined) closing = setTimeout(hide, exitDelay);
    };
    const render = (target: HTMLElement) => {
      const label = target.dataset.tooltip || target.getAttribute('aria-label');
      const bounds = target.getBoundingClientRect();
      if (
        !label ||
        !target.isConnected ||
        !target.checkVisibility() ||
        target.closest('[inert]') ||
        bounds.bottom <= 0 ||
        bounds.top >= innerHeight
      ) {
        hide();
        return;
      }
      tooltip.textContent = label;
      tooltip.hidden = false;
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
    };
    const show = (target: HTMLElement, delay: number) => {
      cancelClosing();
      if (control === target && (!tooltip.hidden || (opening !== undefined && delay > 0))) return;
      hide();
      control = target;
      opening = setTimeout(() => {
        opening = undefined;
        render(target);
        if (!tooltip.hidden)
          labels.observe(target, { attributeFilter: ['aria-label', 'data-tooltip'] });
      }, delay);
    };
    const pointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const target = find(event.target);
      if (target) {
        show(target, hoverDelay);
        return;
      }
      if (overHint(event)) {
        cancelClosing();
        return;
      }
      if (control && !control.isConnected) hide();
    };
    const pointerOut = (event: PointerEvent) => {
      if (
        event.pointerType === 'touch' ||
        !control ||
        !(event.target instanceof Node) ||
        !control.contains(event.target)
      )
        return;
      const next = event.relatedTarget;
      if (next instanceof Node && control.contains(next)) return;
      if (control.matches(':focus-visible')) return;
      cancelOpening();
      scheduleClose();
    };
    const pointerMove = (event: PointerEvent) => {
      if (!control || tooltip.hidden || event.pointerType === 'touch') return;
      if ((event.target instanceof Node && control.contains(event.target)) || overHint(event))
        cancelClosing();
      else if (!control.matches(':focus-visible')) scheduleClose();
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
    const scroll = () => {
      if (!control) return;
      if (!control.matches(':hover, :focus-visible')) hide();
      else if (!tooltip.hidden) render(control);
    };

    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    document.addEventListener('pointerover', pointerOver, options);
    document.addEventListener('pointerout', pointerOut, options);
    document.addEventListener('pointermove', pointerMove, options);
    document.addEventListener('focusin', focusIn, options);
    document.addEventListener('focusout', focusOut, options);
    document.addEventListener('pointerdown', hide, options);
    document.addEventListener('click', hide, { ...options, capture: true });
    window.addEventListener('keydown', escape, { ...options, capture: true });
    window.addEventListener('scroll', scroll, { ...options, capture: true, passive: true });
    window.addEventListener('resize', hide, options);
    return () => {
      listeners.abort();
      hide();
    };
  }, []);
  return <div className="control-tooltip" role="tooltip" aria-hidden="true" ref={element} hidden />;
}
