import { useInterfaceLanguage } from './interface-language';
import { Fragment, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import type { Message, Thread, TurnInfo } from '../shared/types';
import { parseQuestionReplies } from '../shared/question-replies';
import { groupTurns, commandCounts, workDuration, type TurnActivity } from './activity';
import { Icon } from './primitives';
import { MessageTime } from './MessageTime';
import { isTurnOutcome, TurnResult, type TurnOutcome } from './TurnResult';
import { TurnPromptBar, type TurnPrompt } from './TurnPromptBar';

type RenderMessage = (
  item: Message,
  finalReply: boolean,
  changes?: Message,
  timestamp?: number,
  completion?: ReactNode,
) => ReactNode;
const isActivity = (item: Message) => item.kind === 'command' || item.kind === 'tool';

function ActivityGroup({ items, render }: { items: Message[]; render: RenderMessage }) {
  const { t } = useInterfaceLanguage();
  const [open, setOpen] = useState(false);
  const counts = commandCounts(items);
  return (
    <details className="activity-group" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <Icon name="terminal" size={14} />
        <span>
          {items.length} {items.length === 1 ? t('activity') : t('activities')}
        </span>
        <span className="work-history-status">
          {!!counts.completed && (
            <span>
              {counts.completed}
              {' ' + t('completed')}
            </span>
          )}
          {!!counts.failed && (
            <span className="work-history-failed">
              {counts.failed}
              {' ' + t('failed')}
            </span>
          )}
          {!!counts.running && (
            <span>
              {counts.running}
              {' ' + t('running')}
            </span>
          )}
          {!!counts.stopped && (
            <span>
              {counts.stopped}
              {' ' + t('stopped')}
            </span>
          )}
          {!!counts.unknown && (
            <span>
              {counts.unknown}
              {' ' + t('status unavailable')}
            </span>
          )}
        </span>
        <Icon name="chevron" size={12} />
      </summary>
      {open && items.map((item) => <Fragment key={item.id}>{render(item, false)}</Fragment>)}
    </details>
  );
}

function WorkItems({ items, render }: { items: Message[]; render: RenderMessage }) {
  const runs: Message[][] = [];
  for (const item of items) {
    const previous = runs.at(-1);
    if (isActivity(item) && previous && isActivity(previous[0]!)) previous.push(item);
    else runs.push([item]);
  }
  return runs.map((run) =>
    isActivity(run[0]!) ? (
      <ActivityGroup key={run[0]!.id} items={run} render={render} />
    ) : (
      <Fragment key={run[0]!.id}>{render(run[0]!, false)}</Fragment>
    ),
  );
}

function Turn({
  turn,
  render,
  completion,
  showStandaloneTime,
}: {
  turn: TurnActivity;
  render: RenderMessage;
  completion?: ReactNode;
  showStandaloneTime: boolean;
}) {
  const { t } = useInterfaceLanguage();
  const [choices, setChoices] = useState<Record<number, boolean>>({});
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!turn.active || turn.info?.startedAtMs === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [turn.active, turn.info?.startedAtMs]);
  const elapsed = workDuration(turn.info, turn.active ? now : undefined, t);
  const label = turn.active
    ? elapsed
      ? t('Work history · {elapsed}', { elapsed })
      : t('Work history')
    : elapsed
      ? t('Worked for {elapsed}', { elapsed })
      : t('Work history');
  const last = turn.replies.at(-1);
  const segments: Message[][] = [];
  for (const item of turn.work) {
    const previous = segments.at(-1);
    if (item.kind !== 'question' && previous && previous[0]?.kind !== 'question')
      previous.push(item);
    else segments.push([item]);
  }
  const disclosure = (items: Message[], index: number) => {
    const open = choices[index] ?? turn.active;
    const tools = items.filter(isActivity);
    const counts = commandCounts(tools);
    return (
      <section className="work-history" key={index}>
        <button
          className="work-history-toggle"
          aria-expanded={open}
          aria-controls={`work-${turn.id}-${index}`}
          onClick={() => setChoices((previous) => ({ ...previous, [index]: !open }))}
        >
          <span>{label}</span>
          <Icon name="chevron" size={12} />
          <span className="work-history-status">
            {!!tools.length && (
              <span>
                {tools.length} {tools.length === 1 ? t('activity') : t('activities')}
              </span>
            )}
            {!!counts.failed && (
              <span className="work-history-failed">
                {counts.failed}
                {' ' + t('failed')}
              </span>
            )}
            {!!counts.stopped && (
              <span>
                {counts.stopped}
                {' ' + t('stopped')}
              </span>
            )}
            {!!counts.running && (
              <span>
                {counts.running}
                {' ' + t('running')}
              </span>
            )}
            {!!counts.unknown && (
              <span>
                {counts.unknown}
                {' ' + t('status unavailable')}
              </span>
            )}
            {turn.info?.status === 'failed' && (
              <span className="work-history-failed">{t('Turn failed')}</span>
            )}
            {turn.info?.status === 'interrupted' && <span>{t('Turn interrupted')}</span>}
          </span>
        </button>
        <div id={`work-${turn.id}-${index}`} hidden={!open} className="work-history-items">
          {open && <WorkItems items={items} render={render} />}
        </div>
      </section>
    );
  };
  return (
    <section className="turn" data-turn-id={turn.id}>
      {turn.users.map((item, index) => (
        <Fragment key={item.id}>
          {render(item, false, undefined, index === 0 ? turn.info?.startedAtMs : undefined)}
        </Fragment>
      ))}
      {!segments.length && elapsed !== undefined && (
        <div className="work-history work-history-label">{label}</div>
      )}
      {segments.map((items, index) =>
        items[0]?.kind === 'question' ? (
          <Fragment key={items[0].id}>{render(items[0], false)}</Fragment>
        ) : (
          disclosure(items, index)
        ),
      )}
      {turn.replies.map((item) => (
        <Fragment key={item.id}>
          {render(
            item,
            item === last && !turn.active,
            item === last ? turn.changes : undefined,
            item === last ? turn.info?.completedAtMs : undefined,
            item === last ? completion : undefined,
          )}
        </Fragment>
      ))}
      {!last && turn.changes && render(turn.changes, false)}
      {!last && showStandaloneTime && turn.info?.completedAtMs !== undefined && (
        <div className="message-footer">
          <MessageTime value={turn.info.completedAtMs} kind="finished" />
        </div>
      )}
    </section>
  );
}

export function Transcript({
  messages,
  turns,
  activeIds,
  result,
  viewport,
  projectId,
  pending,
  steering,
  loadEarlier,
  render,
}: {
  messages: Message[];
  turns?: TurnInfo[];
  activeIds?: string[];
  result?: { status: TurnOutcome; turn?: TurnInfo };
  viewport: RefObject<HTMLDivElement | null>;
  projectId: string;
  pending?: Thread['pending'];
  steering?: Thread['steering'];
  loadEarlier?: () => Promise<void>;
  render: RenderMessage;
}) {
  const entries = useMemo(
    () => groupTurns(messages, turns, activeIds),
    [messages, turns, activeIds],
  );
  const prompts = useMemo(() => {
    const result = new Map<string, TurnPrompt>();
    for (const turn of entries) {
      const receipt = pending?.kind === 'send' && pending.turnId === turn.id ? pending : undefined;
      const accepted = steering?.findLast(
        (entry) =>
          entry.turnId === turn.id &&
          (entry.state === 'acknowledged' || entry.state === 'completed') &&
          !entry.questionReply &&
          !parseQuestionReplies(entry.text),
      );
      const original = accepted
        ? turn.users.findLast((message) => message.clientId === accepted.id)
        : turn.users.findLast((message) => !parseQuestionReplies(message.text));
      if (accepted)
        result.set(turn.id, {
          text: original?.text ?? accepted.text,
          original,
          canLoadEarlier: false,
        });
      else if (original) result.set(turn.id, { text: original.text, original });
      else if (receipt && !parseQuestionReplies(receipt.text ?? ''))
        result.set(turn.id, { text: receipt.text ?? '' });
    }
    return result;
  }, [entries, pending, steering]);
  const currentTurn = result?.turn && entries.find((turn) => turn.id === result.turn?.id);
  const currentInReply = !!(currentTurn?.replies.length && result?.turn?.usage);
  return (
    <>
      <TurnPromptBar
        viewport={viewport}
        projectId={projectId}
        prompts={prompts}
        loadEarlier={loadEarlier}
      />
      {entries.map((turn) => {
        const info = turn.info;
        const completion =
          turn === currentTurn && currentInReply && result ? (
            <TurnResult status={result.status} turn={result.turn} current />
          ) : !turn.active && info?.usage && isTurnOutcome(info.status) ? (
            <TurnResult status={info.status} turn={info} />
          ) : undefined;
        return (
          <Turn
            key={turn.id}
            turn={turn}
            render={render}
            completion={completion}
            showStandaloneTime={turn !== currentTurn}
          />
        );
      })}
      {result && !currentInReply && (
        <TurnResult
          status={result.status}
          turn={result.turn}
          current
          showTime={!currentTurn?.replies.length}
        />
      )}
    </>
  );
}
