# Conversation sidebar

The sidebar displays lightweight project and conversation summaries. Open [Projects and chats](conversations.md) for the user workflow.

## Layout

- Show one card per registered project. Within a group, pinned projects come first, then projects by the latest observed conversation update. Empty projects follow in name order.
- Open the current project and active work by default. Fold inactive cards and remember explicit user choices. Load a folded project's conversation page when needed.
- Show each conversation's status and update time. Render times in the browser's timezone with a full timestamp on hover. Keep page cursors within their project.
- Put new conversation and project actions on the card. Rename the selected conversation in the workspace header and archive or restore from the row.
- Use the archive view for archived projects and archived conversations. A project's archive state is independent of its chats' archive state.
- Share title search and refresh across the visible project navigation. Native pagination reaches beyond the local summary snapshot. Each card brings in metadata without loading its conversations' message bodies.

## State sources and precedence

| Source                                                    | Visible result                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| Uncertain send, review, steer, or queued dispatch receipt | **Check result** takes precedence over a terminal label             |
| Uncertain archive receipt                                 | **Check archive** and protected metadata controls                   |
| Pending operation with an inactive saved state            | Confirmation state rather than a new success outcome                |
| Native task and interaction state                         | Ready, running, completed, failed, stopped, or awaiting interaction |
| Queue aggregate                                           | Waiting count, pause, failure, or uncertain result                  |
| Browser connection                                        | Separate connection status and reconnect action                     |

Native list observations can update available summaries when there is no owned execution lease or pending interaction. Native idle or unloaded status alone cannot settle an operation. Opening imported history can establish an outcome, which a later stale list result must preserve. Revisions protect newer activity and simultaneous rename or archive updates.

Project activity is available from the local summary before native list pages finish. Cards share a four-request list budget. Summary events and selected conversation events use the existing workspace subscription. Queue badges use metadata and omit accepted deliveries.

## Interaction and verification

Conversation rows keep the title as the accessible name and expose time, execution, and queue details in their description. The selected item uses `aria-current`. Archive confirmations and keyboard focus remain available in both layouts.

Test precedence, stale-list responses, navigation restore, search, archive behavior, and reconnect with both browser themes. [Interface design](interface-design.md) · [Acceptance](acceptance.md)
