import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { Message } from '../shared/types';
import { groupActivity, commandCounts } from './activity';
import { Icon } from './primitives';

function CommandGroup({
  items,
  render,
}: {
  items: Message[];
  render: (item: Message) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const counts = commandCounts(items);
  const statuses = [
    counts.running && `${counts.running} running`,
    counts.failed && `${counts.failed} failed`,
    counts.stopped && `${counts.stopped} stopped`,
    counts.unknown && `${counts.unknown} status unavailable`,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <details
      className="command-group"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        aria-label={`Command activity: ${items.length} ${items.length === 1 ? 'command' : 'commands'}${statuses ? ', ' + statuses : ', completed'}`}
      >
        <Icon
          name={
            counts.running || counts.failed || counts.unknown
              ? 'terminal'
              : counts.stopped
                ? 'stop'
                : 'check'
          }
          size={15}
        />
        <strong>
          {items.length} {items.length === 1 ? 'command' : 'commands'}
        </strong>
        <span className="command-group-status" aria-live="polite">
          {!!counts.running && <span>{counts.running} running</span>}
          {!!counts.failed && <span className="command-group-failed">{counts.failed} failed</span>}
          {!!counts.stopped && <span>{counts.stopped} stopped</span>}
          {!!counts.unknown && <span>{counts.unknown} status unavailable</span>}
          {counts.completed === items.length && <span>Completed</span>}
        </span>
        <Icon name="chevron" size={12} />
      </summary>
      {open && (
        <div className="command-group-items">
          {items.map((item) => (
            <Fragment key={item.id}>{render(item)}</Fragment>
          ))}
        </div>
      )}
    </details>
  );
}

export function Transcript({
  messages,
  render,
}: {
  messages: Message[];
  render: (item: Message) => ReactNode;
}) {
  const entries = useMemo(() => groupActivity(messages), [messages]);
  return entries.map((entry) =>
    entry.kind === 'commands' ? (
      <CommandGroup key={entry.key} items={entry.items} render={render} />
    ) : (
      <Fragment key={entry.key}>{render(entry.item)}</Fragment>
    ),
  );
}
