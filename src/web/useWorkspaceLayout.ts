import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { saved, save, sidebarWidthKeys } from './browser-storage';
import { readSidebarWidth, useSidebarLayout, type SidebarWidths } from './SidebarResize';
import { usePanelFocus } from './usePanelFocus';

type Panel = 'files' | 'diff';
const contextTabKey = 'codes.context-tab';
const combinedFileViewWidth = 440;
const splitDiffWidth = 640;

export function useWorkspaceLayout(ready: boolean) {
  const [sidebar, setSidebar] = useState(
    window.innerWidth > 1099 && saved('codes.navigation') !== 'closed',
  );
  useEffect(() => {
    if (window.innerWidth > 1099) save('codes.navigation', sidebar ? 'open' : 'closed');
  }, [sidebar]);
  const [panel, setVisiblePanel] = useState<Panel | null>(null);
  const lastPanel = useRef<Panel>(saved(contextTabKey) === 'diff' ? 'diff' : 'files');
  const setPanel = useCallback((next: Panel | null) => {
    if (next && next !== lastPanel.current) {
      lastPanel.current = next;
      save(contextTabKey, next);
    }
    setVisiblePanel(next);
  }, []);
  const workspaceElement = useRef<HTMLDivElement>(null);
  const navigationElement = useRef<HTMLElement>(null);
  const navigationClose = useRef<HTMLButtonElement>(null);
  const contextElement = useRef<HTMLElement>(null);
  const [navigationWidth, setNavigationWidth] = useState(() =>
    readSidebarWidth(saved(sidebarWidthKeys.navigation), 'navigation'),
  );
  const [contextWidth, setContextWidth] = useState(() =>
    readSidebarWidth(saved(sidebarWidthKeys.context), 'context'),
  );
  const [narrow, setNarrow] = useState(window.innerWidth <= 1099);
  const sidebarLayout = useSidebarLayout(
    workspaceElement,
    ready,
    narrow,
    sidebar,
    panel,
    navigationWidth,
    contextWidth,
  );
  const { contextDrawer } = sidebarLayout;
  const [contextSize, setContextSize] = useState<'compact' | 'regular' | 'wide'>('compact');
  const contextOpen = !!panel;
  useLayoutEffect(() => {
    const element = contextElement.current;
    if (!ready || !contextOpen || !element) return;
    const resize = () => {
      const width = element.getBoundingClientRect().width;
      setContextSize(
        width >= splitDiffWidth ? 'wide' : width >= combinedFileViewWidth ? 'regular' : 'compact',
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [contextOpen, ready]);
  const [phoneLayout, setPhoneLayout] = useState(window.innerWidth <= 700);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const resize = () => setPhoneLayout(media.matches);
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  const closeNavigation = useCallback(() => {
    setSidebar(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('[data-open-navigation]')?.focus(),
    );
  }, []);
  const openNavigation = () => {
    setSidebar(true);
    if (!narrow)
      requestAnimationFrame(() => navigationClose.current?.focus({ preventScroll: true }));
  };
  const closeContext = useCallback(() => setVisiblePanel(null), []);
  const dismissContext = () => {
    closeContext();
    if (!contextDrawer)
      requestAnimationFrame(() => {
        workspaceElement.current
          ?.querySelector<HTMLElement>('[data-open-context]')
          ?.focus({ preventScroll: true });
      });
  };
  const toggleContext = () => {
    if (panel) dismissContext();
    else setPanel(lastPanel.current);
  };
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1099px)');
    const resize = () => {
      setNarrow(media.matches);
      setSidebar(media.matches ? false : saved('codes.navigation') !== 'closed');
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  usePanelFocus(navigationElement, narrow && sidebar, closeNavigation, '[data-open-navigation]');
  usePanelFocus(
    contextElement,
    contextDrawer && !(narrow && sidebar),
    closeContext,
    '[data-open-context]',
    '.context-close',
  );

  const changeNavigationWidth = (width: number | undefined) => {
    setNavigationWidth(width);
    save(sidebarWidthKeys.navigation, width === undefined ? '' : String(width));
  };
  const changeContextWidth = (width: number | undefined) => {
    setContextWidth(width);
    save(sidebarWidthKeys.context, width === undefined ? '' : String(width));
  };
  const applySidebarWidths = ({ navigation, context }: SidebarWidths) => {
    setNavigationWidth(navigation ?? undefined);
    setContextWidth(context ?? undefined);
  };

  return {
    sidebar,
    setSidebar,
    panel,
    setPanel,
    narrow,
    contextDrawer,
    compactFiles: contextSize === 'compact',
    allowSplitDiff: contextSize === 'wide',
    phoneLayout,
    workspaceElement,
    navigationElement,
    navigationClose,
    contextElement,
    sidebarLayout,
    openNavigation,
    closeNavigation,
    closeContext,
    dismissContext,
    toggleContext,
    changeNavigationWidth,
    changeContextWidth,
    sidebarWidths: { navigation: navigationWidth ?? null, context: contextWidth ?? null },
    applySidebarWidths,
  };
}
