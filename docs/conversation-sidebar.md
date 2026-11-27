# Conversation sidebar

The sidebar lists active native Codex conversations across all working directories. Choose **Archived** to browse archived conversations. [Conversation workflow](conversations.md)

- Each row shows its title and timestamp, plus activity or a status that needs attention. The working directory appears when it differs from the current directory. Hover or focus the row to see the full path.
- The sort menu shows the current order and marks the selected option. **Last updated** is the default. Choose **Date created** to show the newest conversations first when supported by the installed CLI. The browser remembers the selected order. Use the arrow keys to move between options and Escape to close the menu.
- Search uses native title filtering where available. Older versions use bounded page scans. Page cursors follow the current archive, sort, and search filters.
- **New conversation** starts a draft in the Codex startup directory by default. Enable **Choose each time** to choose a directory when starting a draft. On phones, **New** is next to the brand.
- Rename the selected conversation in the header. On desktop, select, hover over, or focus an active conversation to reveal its archive button. Touch layouts keep the button visible. In **Archived**, restore from the conversation row.
- Use **Retry** by the list error if loading fails. Use **Reconnect updates** by the connection status when the update stream is unavailable.

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
