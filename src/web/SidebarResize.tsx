import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useInterfaceLanguage } from './interface-language';

type Sidebar = 'navigation' | 'context';
type Panel = 'files' | 'diff';
type Range = { width: number; min: number; max: number };

const chatMinimum = 560;
export const sidebarWidthLimits = {
  navigation: { min: 220, max: 440 },
  context: { min: 320, max: 760 },
} as const;
export type SidebarWidths = Record<Sidebar, number | null>;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function readSidebarWidth(saved: string, side: Sidebar) {
  const width = Number(saved);
  const { min, max } = sidebarWidthLimits[side];
  return Number.isFinite(width) && width > 0 ? clamp(Math.round(width), min, max) : undefined;
}

export function useSidebarLayout(
  workspace: RefObject<HTMLDivElement | null>,
  ready: boolean,
  narrow: boolean,
  navigationOpen: boolean,
  panel: Panel | null,
  navigationPreference?: number,
  contextPreference?: number,
) {
  const [viewport, setViewport] = useState(window.innerWidth);
  useLayoutEffect(() => {
    const element = workspace.current;
    if (!ready || !element) return;
    const resize = () => setViewport(element.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [workspace, ready]);

  const available = viewport - chatMinimum;
  const { navigation, context } = sidebarWidthLimits;
  const navigationMax = (contextWidth: number) =>
    Math.max(navigation.min, Math.min(navigation.max, available - contextWidth));
  const left =
    navigationOpen && !narrow
      ? clamp(navigationPreference ?? 260, navigation.min, navigationMax(0))
      : 0;
  const contextMax = Math.max(context.min, Math.min(context.max, available - left));
  const defaultContext =
    panel === 'files'
      ? Math.min(viewport * 0.32, 460)
      : navigationOpen
        ? Math.min(viewport * 0.38, 560)
        : Math.min(viewport * 0.44, 640);
  const right = panel
    ? clamp(contextPreference ?? Math.round(defaultContext), context.min, context.max)
    : 0;
  // Predict the docked width from both rails so moving the panel cannot change the threshold.
  const contextDrawer = !!panel && (narrow || available - left < right);
  return {
    contextDrawer,
    navigation: {
      width: left,
      min: navigation.min,
      max: navigationMax(contextDrawer ? 0 : right),
    },
    context: { width: right, min: context.min, max: contextMax },
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
