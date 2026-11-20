import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Message, TurnInfo } from '../shared/types';
import { groupTurns, commandCounts, workDuration, type TurnActivity } from './activity';
import { Icon } from './primitives';
import { MessageTime } from './MessageTime';

type RenderMessage = (
  item: Message,
  finalReply: boolean,
  changes?: Message,
  timestamp?: number,
) => ReactNode;
const isActivity = (item: Message) => item.kind === 'command' || item.kind === 'tool';

function ActivityGroup({ items, render }: { items: Message[]; render: RenderMessage }) {
  const [open, setOpen] = useState(false);
  const counts = commandCounts(items);
  return (
    <details className="activity-group" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <Icon name="terminal" size={14} />
        <span>
          {items.length} {items.length === 1 ? 'activity' : 'activities'}
        </span>
        <span className="work-history-status">
          {!!counts.completed && <span>{counts.completed} completed</span>}
          {!!counts.failed && <span className="work-history-failed">{counts.failed} failed</span>}
          {!!counts.running && <span>{counts.running} running</span>}
          {!!counts.stopped && <span>{counts.stopped} stopped</span>}
          {!!counts.unknown && <span>{counts.unknown} status unavailable</span>}
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

function Turn({ turn, render }: { turn: TurnActivity; render: RenderMessage }) {
  const [choice, setChoice] = useState<boolean>();
  const open = choice ?? turn.active;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!turn.active || turn.info?.startedAtMs === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [turn.active, turn.info?.startedAtMs]);
  const elapsed = workDuration(turn.info, turn.active ? now : undefined);
  const label = turn.active
    ? elapsed
      ? `Working · ${elapsed}`
      : 'Working'
    : elapsed
      ? `Worked for ${elapsed}`
      : 'Work history';
  const last = turn.replies.at(-1);
  const segments: Message[][] = [];
  for (const item of turn.work) {
    const previous = segments.at(-1);
    if (item.kind !== 'question' && previous && previous[0]?.kind !== 'question')
      previous.push(item);
    else segments.push([item]);
  }
  if (!segments.length && elapsed !== undefined) segments.push([]);
  const disclosure = (items: Message[], index: number) => {
    const tools = items.filter(isActivity);
    const counts = commandCounts(tools);
    return (
      <section className="work-history" key={index}>
        <button
          className="work-history-toggle"
          aria-expanded={open}
          aria-controls={`work-${turn.id}-${index}`}
          onClick={() => setChoice(!open)}
        >
          <span>{label}</span>
          <Icon name="chevron" size={12} />
          <span className="work-history-status">
            {!!tools.length && (
              <span>
                {tools.length} {tools.length === 1 ? 'activity' : 'activities'}
              </span>
            )}
            {!!counts.failed && <span className="work-history-failed">{counts.failed} failed</span>}
            {!!counts.stopped && <span>{counts.stopped} stopped</span>}
            {!!counts.running && <span>{counts.running} running</span>}
            {!!counts.unknown && <span>{counts.unknown} status unavailable</span>}
            {turn.info?.status === 'failed' && (
              <span className="work-history-failed">Turn failed</span>
            )}
            {turn.info?.status === 'interrupted' && <span>Turn interrupted</span>}
          </span>
        </button>
        <div id={`work-${turn.id}-${index}`} hidden={!open} className="work-history-items">
          {open && <WorkItems items={items} render={render} />}
          {open && !items.length && (
            <p className="work-history-empty">No additional activity in the loaded history.</p>
          )}
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
          )}
        </Fragment>
      ))}
      {!last && turn.changes && render(turn.changes, false)}
      {!last && turn.info?.completedAtMs !== undefined && (
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
  render,
}: {
  messages: Message[];
  turns?: TurnInfo[];
  activeIds?: string[];
  render: RenderMessage;
}) {
  const entries = useMemo(
    () => groupTurns(messages, turns, activeIds),
    [messages, turns, activeIds],
  );
  return entries.map((turn) => <Turn key={turn.id} turn={turn} render={render} />);
}
