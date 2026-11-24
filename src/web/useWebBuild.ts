import { useEffect, useState } from 'react';
import { webBuildSignature } from '../shared/web-build';
import { request } from './api';

const interval = 60_000;
export function useWebBuild(signedIn: boolean) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    const current = webBuildSignature(
      [...document.head.querySelectorAll('script[src], link[href]')].map(
        (element) => element.getAttribute('src') ?? element.getAttribute('href'),
      ),
    );
    if (!signedIn || !current) return;
    let controller: AbortController | undefined;
    let lastCheck = -interval;
    const check = () => {
      if (document.hidden || controller || performance.now() - lastCheck < interval) return;
      controller = new AbortController();
      const signal = controller.signal;
      lastCheck = performance.now();
      void request<{ signature: string }>('/web-build', {}, signal)
        .then(
          ({ signature }) => {
            if (!signal.aborted) setUpdateAvailable(!!signature && signature !== current);
          },
          () => {
            // An update check is optional. The next visible interval can retry it.
          },
        )
        .finally(() => {
          controller = undefined;
        });
    };
    check();
    const timer = setInterval(check, interval);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', check);
    };
  }, [signedIn]);
  return updateAvailable;
}
