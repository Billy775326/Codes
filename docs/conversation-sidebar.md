# Conversation sidebar

The sidebar manages native conversations for the selected project. It uses the existing task state, durable execution receipts and FIFO queue, with a lightweight metadata projection. It does not introduce a second execution state machine.

## Layout

1. Project selection and Add project, followed by New conversation.
2. Title search and Refresh, then Chats / Archived. Chats includes completed conversations; it does not mean currently running tasks.
3. Date groups with two-line rows: title, then task status and last update time. A nonempty queue adds its count and any paused/error condition. The selected row stays highlighted; secondary operations live in its actions menu.
4. Native Previous / Next pagination when needed. Connection/reconnect and Sign out remain in the navigation footer. During a disconnected subscription the list also offers Updates paused; saved task states remain visible.

Search uses native cursors, including conversations beyond the local 200-summary window. There are no global counts, page-only task filters presented as global filters, automatic history loads for individual rows, or per-row event connections. Times use native/server `updatedAt` in milliseconds, rendered in the browser's timezone with a full timestamp tooltip. Status-only refreshes do not advance this timestamp.

## State sources and precedence

| Source                                             | Visible state                                                                           | Behavior                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Unknown send/review/steer receipt or queue outcome | Check result                                                                            | Takes precedence over terminal labels; never automatically resends                 |
| Pending archive receipt                            | Check archive                                                                           | Rename/archive controls remain protected; Check status queries native evidence     |
| Pending execution with a non-active saved state    | Confirming result                                                                       | Does not present saved completion as a confirmed new result                        |
| Task state                                         | Ready, Running, Needs approval, Needs answer, Done, Failed, Interrupted, Status unknown | Task and interaction lifecycle updates remain authoritative for owned executions   |
| Queue aggregate                                    | Count, Paused, Failed, Check result                                                     | Displayed alongside task state; completed/cancelled entries excluded               |
| Browser connection                                 | Updates paused                                                                          | Separate from execution state; disconnect does not mean task failure or completion |

The SQLite summary projection reads only aggregate queue/receipt metadata, never queued message bodies. Optional summary fields are additive; schema 4 and stored settings/history remain unchanged. Queue counts include unfinished dispatched entries as well as waiting entries, so the label is “in queue”, not “waiting”. An empty paused queue has no queue badge.

Native `thread/list` observations and `thread/status/changed` update known conversations that have no owned execution lease or pending interaction. `idle` and `notLoaded` do not prove a task completed; existing terminal outcomes are retained, while an unloaded previously active conversation becomes Status unknown. Unknown owned receipts remain protected until existing reconciliation establishes their outcome. Native status payloads are validated before use. Runtime flags are not evidence about a separate Codex process sharing the same account.

A lifecycle revision prevents a native list response captured before a newer event from overwriting it. The browser likewise merges metadata received while its list request was in flight. Queue changes publish the same summary projection and refresh the cached snapshot. A ready connection re-reads the current list page, retaining search and cursor, to recover updates missed beyond event replay. This uses the existing single project-or-thread subscription; it does not add a second stream.

## Interaction and verification

Conversation buttons retain their title as the accessible name, with status/time/queue information in the accessible description. Selected rows use `aria-current`; actions expose expanded state. Mobile actions stay visible and fit 320px layouts. Dark and light themes share semantic palette tokens. Archive confirmation and rename retain their existing keyboard/modal behavior and execution protections.

Tests cover state precedence, body-free summary aggregation, native status transitions, delayed-list races, selection/reload, paused queues, narrow layouts, both themes, and reconnect refresh with search preservation. Existing conversation tests retain archive/restore, drafts, two-client synchronization, and native pagination beyond 200 rows. Simulator evidence is separate from actual preview checks and does not establish real model execution acceptance.

Protocol reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server), checked against the local CLI 0.167.0 generated `ThreadStatus` and `ThreadStatusChangedNotification` types. Newer documentation features are not assumed available in this pinned adapter.
