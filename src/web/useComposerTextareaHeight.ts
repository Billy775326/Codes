import { useLayoutEffect, type RefObject } from 'react';

function fitText(textarea: HTMLTextAreaElement) {
  // Reset the measured height so the field can shrink. CSS defines the bounds.
  textarea.style.height = '0px';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export function useComposerTextareaHeight(
  ref: RefObject<HTMLTextAreaElement | null>,
  text: string,
  visible: boolean,
) {
  useLayoutEffect(() => {
    if (visible && ref.current) fitText(ref.current);
  }, [ref, text, visible]);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!visible || !textarea) return;
    let width = textarea.getBoundingClientRect().width;
    const observeWidth = new ResizeObserver(([entry]) => {
      const size = entry?.borderBoxSize?.[0]?.inlineSize ?? textarea.getBoundingClientRect().width;
      if (size === width) return;
      width = size;
      fitText(textarea);
    });
    observeWidth.observe(textarea, { box: 'border-box' });
    return () => observeWidth.disconnect();
  }, [ref, visible]);
}
