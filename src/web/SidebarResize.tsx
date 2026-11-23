import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useInterfaceLanguage } from './interface-language';

type Sidebar = 'navigation' | 'context';
type Panel = 'files' | 'diff';
type Range = { width: number; min: number; max: number };

const chatMinimum = 460;
const navigationMinimum = 220;
const contextMinimum = 320;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function readSidebarWidth(saved: string) {
  const width = Number(saved);
  return Number.isFinite(width) && width > 0 ? Math.round(width) : undefined;
}

export function useSidebarLayout(
  navigationOpen: boolean,
  panel: Panel | null,
  navigationPreference?: number,
  contextPreference?: number,
) {
  const [viewport, setViewport] = useState(window.innerWidth);
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setViewport(window.innerWidth));
    };
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frame);
    };
  }, []);

  const available = viewport - chatMinimum;
  const navigationMax = (contextWidth: number) =>
    Math.max(navigationMinimum, Math.min(440, available - contextWidth));
  const left = navigationOpen
    ? clamp(
        navigationPreference ?? 260,
        navigationMinimum,
        navigationMax(panel ? contextMinimum : 0),
      )
    : 0;
  const contextMax = Math.max(contextMinimum, Math.min(760, available - left));
  const defaultContext =
    panel === 'files'
      ? Math.min(viewport * 0.32, 460)
      : navigationOpen
        ? Math.min(viewport * 0.38, 560)
        : Math.min(viewport * 0.44, 640);
  const right = panel
    ? clamp(contextPreference ?? Math.round(defaultContext), contextMinimum, contextMax)
    : 0;
  return {
    navigation: { width: left, min: navigationMinimum, max: navigationMax(right) },
    context: { width: right, min: contextMinimum, max: contextMax },
  };
}

type Drag = { element: HTMLDivElement; pointer: number; start: number; frame: number };

export function SidebarResize({
  side,
  range,
  workspace,
  change,
}: {
  side: Sidebar;
  range: Range;
  workspace: RefObject<HTMLDivElement | null>;
  change: (value?: number) => void;
}) {
  const { t } = useInterfaceLanguage();
  const drag = useRef<Drag>(null);
  const property = `--${side}-preview`;
  const direction = side === 'navigation' ? 1 : -1;
  const { width, min, max } = range;
  const clear = useCallback(() => {
    const pending = drag.current;
    if (!pending) return;
    drag.current = null;
    cancelAnimationFrame(pending.frame);
    workspace.current?.style.removeProperty(property);
    workspace.current?.removeAttribute('data-sidebar-resizing');
    if (pending.element.hasPointerCapture(pending.pointer))
      pending.element.releasePointerCapture(pending.pointer);
  }, [property, workspace]);
  useLayoutEffect(() => clear, [clear, width, min, max]);
  const fromPointer = (x: number, start: number) =>
    clamp(Math.round(width + (x - start) * direction), min, max);

  return (
    <div
      className="sidebar-resize"
      data-side={side}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t(side === 'navigation' ? 'Resize navigation' : 'Resize project panel')}
      aria-controls={`sidebar-${side}`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-valuetext={`${width} px`}
      onPointerDown={(event) => {
        if (event.button !== 0 || workspace.current?.hasAttribute('data-sidebar-resizing')) return;
        event.preventDefault();
        const element = event.currentTarget;
        element.focus({ preventScroll: true });
        element.setPointerCapture(event.pointerId);
        drag.current = { element, pointer: event.pointerId, start: event.clientX, frame: 0 };
        workspace.current?.setAttribute('data-sidebar-resizing', side);
      }}
      onPointerMove={(event) => {
        const pending = drag.current;
        if (!pending || event.pointerId !== pending.pointer) return;
        const next = fromPointer(event.clientX, pending.start);
        cancelAnimationFrame(pending.frame);
        pending.frame = requestAnimationFrame(() => {
          workspace.current?.style.setProperty(property, `${next}px`);
        });
      }}
      onPointerUp={(event) => {
        const pending = drag.current;
        if (!pending || event.pointerId !== pending.pointer) return;
        const next = fromPointer(event.clientX, pending.start);
        clear();
        if (next !== width) change(next);
      }}
      onPointerCancel={clear}
      onLostPointerCapture={clear}
      onDoubleClick={() => change()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) {
          event.preventDefault();
          clear();
          return;
        }
        let next: number;
        switch (event.key) {
          case 'ArrowLeft':
            next = width - 16 * direction;
            break;
          case 'ArrowRight':
            next = width + 16 * direction;
            break;
          case 'Home':
            next = min;
            break;
          case 'End':
            next = max;
            break;
          default:
            return;
        }
        event.preventDefault();
        const bounded = clamp(next, min, max);
        if (bounded !== width) change(bounded);
      }}
    />
  );
}
