# Conversation sidebar

The sidebar groups native conversations under every registered project. Each project remembers its last conversation or explicit new-draft view in this browser; switching retains independent conversation text drafts and server-backed settings. See [directory ownership and recovery](session-navigation-proposal.md). It uses the existing task state, durable execution receipts and FIFO queue, with a lightweight metadata projection. It does not introduce a second execution state machine.

## Layout

1. A shared conversation-view dropdown (Chats / Archived), Refresh, and search apply across projects. Search by project name to see its conversations, or by conversation title to find matching conversations across projects.
2. Pinned projects appear first. Within each group, cards follow their latest observed conversation update, with empty projects last in name order. Inactive projects show only their name by default. The current project and projects with ongoing work open by default. A manual open or collapse overrides the default and is remembered in this browser. Search and the archived view temporarily open cards. In an open card, the name restores its last view, the plus button starts a conversation there, and the actions button offers rename and pin controls. Renaming changes the workspace label while keeping the directory and existing conversations.
3. Each open card lists conversations by latest update in a continuous list. Each row keeps its timestamp, task outcome, and queue condition. Ready stays in the accessible description. Each card has its own native Previous / Next pagination. The conversation menu offers rename, archive or restore, and Copy link. A copied link opens the conversation in its registered project after workspace sign-in.
4. The footer contains connection status, Settings, and Workspace actions. Workspace actions holds Add project, Reconnect updates, and Sign out. The empty workspace offers one Add project entry.

Settings appears in the footer when navigation is open, and in the conversation header when it is closed. The layout removes duplicate connection controls and routine state labels without removing recovery actions or archived conversations.

Search uses native cursors, including conversations beyond the local 200-summary window. There are no global counts, page-only task filters presented as global filters, automatic history loads for individual rows, or per-row event connections. Times use native/server `updatedAt` in milliseconds, rendered in the browser's timezone with a full timestamp tooltip. Status-only refreshes do not advance this timestamp.

## State sources and precedence

| Source                                             | Visible state                                                                            | Behavior                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Unknown send/review/steer receipt or queue outcome | Check result                                                                             | Takes precedence over terminal labels; never automatically resends                 |
| Pending archive receipt                            | Check archive                                                                            | Rename/archive controls remain protected; Check status queries native evidence     |
| Pending execution with a non-active saved state    | Confirming result                                                                        | Does not present saved completion as a confirmed new result                        |
| Task state                                         | Ready, Running, Needs approval, Needs answer, Completed, Failed, Stopped, Status unknown | Task and interaction lifecycle updates remain authoritative for owned executions   |
| Queue aggregate                                    | Count, Paused, Failed, Check result                                                      | Displayed alongside task state; sent/completed/cancelled entries excluded          |
| Browser connection                                 | Connection status                                                                        | Separate from execution state; disconnect does not mean task failure or completion |

The SQLite summary projection reads only aggregate queue/receipt metadata, never queued message bodies. Optional summary fields are additive; schema 4 and stored settings/history remain unchanged. Queue counts include waiting, dispatching and uncertain-delivery entries; confirmed deliveries leave the visible queue while their execution receipts are retained. An empty paused queue has no queue badge.

Native `thread/list` observations and `thread/status/changed` update known conversations that have no owned execution lease or pending interaction. `idle` and `notLoaded` do not prove a task completed; existing terminal outcomes are retained, while an unloaded previously active conversation becomes Status unknown. Unknown owned receipts remain protected until existing reconciliation establishes their outcome. Native status payloads are validated before use. Runtime flags are not evidence about a separate Codex process sharing the same account.

Opening an imported conversation records its history-established state in the summary, so refreshing the list cannot return it to an older idle/unknown label. Unfinished receipts stay unknown, and concurrent title/archive changes are retained.

A lifecycle revision prevents a native list response captured before a newer event from overwriting it. The browser likewise merges metadata received while its list request was in flight. The initial project list includes saved conversation activity so card order and folding are available before the first native list reads finish. Folded cards load their conversation page on demand. Search, the archived view, and manual Refresh can query all projects. Queue changes publish the same summary projection and refresh the cached snapshot. A ready connection refreshes open cards' displayed pages with their search and cursor. Cards share a budget of four concurrent list reads. Summary events update the owning project through the existing single project-or-thread subscription, including while another project is selected.

## Interaction and verification

Conversation buttons retain their title as the accessible name, with status/time/queue information in the accessible description. Selected rows use `aria-current`; actions expose expanded state. Mobile actions stay visible and fit 320px layouts. Dark and light themes share semantic palette tokens. Archive confirmation and rename retain their existing keyboard/modal behavior and execution protections.

Tests cover state precedence, body-free summary aggregation, native status transitions, delayed-list races, selection/reload, paused queues, narrow layouts, both themes, and reconnect refresh with search preservation. Existing conversation tests retain archive/restore, drafts, two-client synchronization, and native pagination beyond 200 rows. Simulator evidence is separate from actual preview checks and does not establish real model execution acceptance.

Protocol reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server), checked against the local CLI 0.167.0 generated `ThreadStatus` and `ThreadStatusChangedNotification` types. Newer documentation features are not assumed available in this pinned adapter.
