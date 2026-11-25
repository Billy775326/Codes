import { useCallback, useEffect, useRef, useState } from 'react';
import { saved, save } from './browser-storage';
import { readSidebarWidth, useSidebarLayout } from './SidebarResize';
import { usePanelFocus } from './usePanelFocus';

export function useWorkspaceLayout() {
  const [sidebar, setSidebar] = useState(
    window.innerWidth > 1099 && saved('codes.navigation') !== 'closed',
  );
  useEffect(() => {
    if (window.innerWidth > 1099) save('codes.navigation', sidebar ? 'open' : 'closed');
  }, [sidebar]);
  const [panel, setPanel] = useState<'files' | 'diff' | null>(null);
  const workspaceElement = useRef<HTMLDivElement>(null);
  const navigationElement = useRef<HTMLElement>(null);
  const navigationClose = useRef<HTMLButtonElement>(null);
  const contextElement = useRef<HTMLElement>(null);
  const [navigationWidth, setNavigationWidth] = useState(() =>
    readSidebarWidth(saved('codes.navigation-width')),
  );
  const [contextWidth, setContextWidth] = useState(() =>
    readSidebarWidth(saved('codes.context-width')),
  );
  const sidebarLayout = useSidebarLayout(sidebar, panel, navigationWidth, contextWidth);
  const [narrow, setNarrow] = useState(window.innerWidth <= 1099);
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
  const closeContext = useCallback(() => setPanel(null), []);
  const dismissContext = () => {
    closeContext();
    if (!narrow)
      requestAnimationFrame(() => {
        workspaceElement.current
          ?.querySelector<HTMLElement>(`[data-project-view="${panel}"]`)
          ?.focus({ preventScroll: true });
      });
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
    narrow && !!panel && !sidebar,
    closeContext,
    '[data-browse-files]',
    '.context-close',
  );

  const changeNavigationWidth = (width: number | undefined) => {
    setNavigationWidth(width);
    save('codes.navigation-width', width === undefined ? '' : String(width));
  };
  const changeContextWidth = (width: number | undefined) => {
    setContextWidth(width);
    save('codes.context-width', width === undefined ? '' : String(width));
  };

  return {
    sidebar,
    setSidebar,
    panel,
    setPanel,
    narrow,
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
    changeNavigationWidth,
    changeContextWidth,
  };
}
