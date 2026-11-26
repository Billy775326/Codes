# Conversation sidebar

The sidebar lists native Codex conversations. The list starts with active sessions in **Cwd** when the working directory is known. **All** spans directories. **Repo** spans linked Git worktrees when available. [Conversation workflow](conversations.md)

- Each row shows the title, relative time, and branch when known. **All** shows each working directory. **Repo** shows a path for sessions outside the current directory. Select **Updated** or **Created** when the installed CLI supports sorting.
- Search matches native name, preview, thread ID, branch, and directory metadata. Reads are bounded and cancellable. Page cursors are tied to the current directory, archive, sort, and search filters.
- Rename the selected conversation in the header. Archive from its sidebar row. Select an archived row to restore and resume it, or use its preview action to read the history. The new conversation button starts a draft in the current directory or prompts for one.

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

Active rows expose the title as the accessible name. Archived rows name the restore and preview actions. Time, execution, and queue details remain available to assistive technology. The selected item uses `aria-current`. Archive confirmations and keyboard focus remain available in both layouts.

Test precedence, stale-list responses, working directory selection, search, archive behavior, and reconnect with both browser themes. [Interface design](interface-design.md) · [Acceptance](acceptance.md)
