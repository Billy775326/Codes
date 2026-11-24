import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Message } from '../shared/types';
import { ImageAttachmentView } from './ImageAttachments';
import { useInterfaceLanguage } from './interface-language';
import { Icon } from './primitives';
import './turn-prompt-bar.css';

export interface TurnPrompt {
  text: string;
  original?: Message;
}

export function TurnPromptBar({
  viewport,
  prompts,
  projectId,
  loadEarlier,
}: {
  viewport: RefObject<HTMLDivElement | null>;
  prompts: ReadonlyMap<string, TurnPrompt>;
  projectId: string;
  loadEarlier?: () => Promise<void>;
}) {
  const { t } = useInterfaceLanguage();
  const detailId = useId();
  const overlay = useRef<HTMLDivElement>(null);
  const turnElements = useRef<NodeListOf<HTMLElement> | undefined>(undefined);
  const current = useRef(prompts);
  const schedule = useRef<() => void>(undefined);
  const [pinned, setPinned] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [locating, setLocating] = useState(false);
  const locateRequest = useRef<string>(undefined);

  const messageElement = (id: string) =>
    viewport.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);

  const focusOriginal = (turnId: string) => {
    const message = current.current.get(turnId)?.original;
    const element = message && messageElement(message.id);
    if (!element) return false;
    element.scrollIntoView({ block: 'start' });
    element.focus({ preventScroll: true });
    setExpanded(undefined);
    return true;
  };

  useLayoutEffect(() => {
    current.current = prompts;
    turnElements.current =
      overlay.current?.parentElement?.querySelectorAll<HTMLElement>(':scope > .turn');
    const turnId = locateRequest.current;
    if (turnId && prompts.get(turnId)?.original) {
      locateRequest.current = undefined;
      requestAnimationFrame(() => {
        if (overlay.current) focusOriginal(turnId);
      });
    }
    schedule.current?.();
  }, [prompts]);

  useEffect(() => {
    const timeline = viewport.current;
    const content = overlay.current?.parentElement;
    if (!timeline || !content) return;
    let frame = 0;
    const refresh = () => {
      frame = 0;
      const top = timeline.getBoundingClientRect().top;
      const turns = turnElements.current;
      if (!turns?.length) {
        setPinned(undefined);
        return;
      }
      let first = 0;
      let end = turns.length;
      while (first < end) {
        const middle = Math.floor((first + end) / 2);
        if (turns[middle]!.getBoundingClientRect().bottom <= top) first = middle + 1;
        else end = middle;
      }
      const turn = turns[first];
      const id = turn?.dataset.turnId;
      const prompt = id && current.current.get(id);
      const original = prompt && prompt.original && messageElement(prompt.original.id);
      const turnsPastPrompt =
        turn &&
        turn.getBoundingClientRect().top <= top &&
        (!original || original.getBoundingClientRect().bottom <= top);
      setPinned(prompt && turnsPastPrompt ? id : undefined);
    };
    const update = () => {
      if (!frame) frame = requestAnimationFrame(refresh);
    };
    const resize = new ResizeObserver(update);
    resize.observe(timeline);
    resize.observe(content);
    schedule.current = update;
    timeline.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      timeline.removeEventListener('scroll', update);
      resize.disconnect();
      cancelAnimationFrame(frame);
      schedule.current = undefined;
    };
  }, [viewport]);

  useEffect(() => {
    setExpanded(undefined);
  }, [pinned]);

  const prompt = pinned ? prompts.get(pinned) : undefined;
  const open = !!pinned && expanded === pinned;
  const toggle = useRef<HTMLButtonElement>(null);
  const locate = async () => {
    if (!pinned || focusOriginal(pinned) || !loadEarlier) return;
    locateRequest.current = pinned;
    setLocating(true);
    try {
      await loadEarlier();
    } finally {
      setLocating(false);
    }
  };
  useEffect(() => {
    if (!locating && locateRequest.current) locateRequest.current = undefined;
  }, [locating]);

  return (
    <div className="turn-prompt-overlay" ref={overlay}>
      {prompt && (
        <div
          className="turn-prompt-bar"
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !open) return;
            event.stopPropagation();
            setExpanded(undefined);
            toggle.current?.focus();
          }}
        >
          <button
            className="turn-prompt-toggle"
            type="button"
            ref={toggle}
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setExpanded(open ? undefined : pinned)}
          >
            <strong>{t('Turn message')}</strong>
            <span>
              {prompt.text.trimStart().slice(0, 180).replace(/\s+/g, ' ') || t('Attachments')}
            </span>
            <Icon name="chevron" size={13} />
          </button>
          <div
            id={detailId}
            hidden={!open}
            className="turn-prompt-detail"
            tabIndex={open ? 0 : undefined}
          >
            {open && (
              <>
                {prompt.text && <p>{prompt.text}</p>}
                {!!prompt.original?.images?.length && (
                  <div className="message-images">
                    {prompt.original.images.map((image, index) => (
                      <ImageAttachmentView
                        key={image.id + ':' + index}
                        image={image}
                        projectId={projectId}
                      />
                    ))}
                  </div>
                )}
                {!!prompt.original?.unavailableImages && (
                  <p className="image-unavailable">
                    {prompt.original.unavailableImages}{' '}
                    {t('image attachment(s) available in native history.')}
                  </p>
                )}
                {(prompt.original || loadEarlier) && (
                  <button type="button" onClick={() => void locate()} disabled={locating}>
                    {t(locating ? 'Loading earlier messages…' : 'Go to original message')}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
