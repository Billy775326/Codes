# Conversation sidebar

The sidebar lists native Codex conversations. The list starts with active sessions across all working directories. Use **Cwd** for the selected working directory or **Archived** for native archived conversations. [Conversation workflow](conversations.md)

- Each row shows a title and timestamp. The **All** view also shows the working directory. Select **Updated** or **Created** when the installed CLI supports sorting.
- Search uses native title filtering where available. Older versions use bounded page scans. Page cursors are tied to the current directory, archive, sort, and search filters.
- Rename the selected conversation in the header. Archive and restore from its sidebar row. The new conversation button starts a draft in the current directory or prompts for one.

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

Browsing uses metadata pages without loading transcripts. A new search or filter cancels obsolete browser reads. Summary events update visible rows through the existing workspace subscription. Queue badges omit accepted deliveries.

## Interaction and verification

Conversation rows keep the title as the accessible name and expose time, execution, and queue details in their description. The selected item uses `aria-current`. Archive confirmations and keyboard focus remain available in both layouts.

Test precedence, stale-list responses, working directory selection, search, archive behavior, and reconnect with both browser themes. [Interface design](interface-design.md) · [Acceptance](acceptance.md)
