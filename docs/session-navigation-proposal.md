# Project and conversation navigation

**Status: adopted design.** Codes retains the project + conversation architecture. This supersedes the earlier proposal to remove the project selector and unify all directories into one conversation list.

A project is an existing server directory. A conversation owns its native history, task, approvals, queue, draft, and saved model/permission choices. Files and Changes follow the selected conversation's verified project. Projects provide directory context; Codex permission presets continue to govern filesystem and network access.

## Layout and navigation

- One project: show its directory name with the full path in the tooltip. There is no one-option selector.
- Multiple projects: keep a compact Project selector above New conversation. Adding a directory stays in Workspace actions. An empty installation has one Add project action.
- Each project retains its last conversation or explicit New conversation view in this browser. Switching back restores that view. Text drafts remain project-scoped before creation and conversation-scoped afterward. Conversation settings remain on the server; project switching does not inherit another conversation's permissions.
- The project view contains its native conversation list, title search, Chats / Archived view, status/recovery actions and cursor pagination. It does not load other projects' transcripts in the background.
- Switching projects or conversations closes previews, cancels stale file/history reads, and clears unsent attachment selections. Background tasks and queues continue on the server.

Browser navigation metadata uses `codes.project-views`, bounded to 20 projects. Existing `codes.project`, `codes.thread`, project drafts and conversation drafts remain readable. A bad remembered conversation cannot silently redirect an explicit project selection to another directory. The user can start a fresh conversation in the selected project.

## Ownership and directory health

The server verifies the stored conversation/project association against native `thread/read` metadata. A thread snapshot includes its small project context and directory health. Cached history uses the saved server association when native execution is offline; filesystem and execution endpoints require a fresh native ownership check. Opening a conversation directly repairs a stale browser project selection before enabling filesystem controls. The browser derives attachment and preview scope from the selected conversation, not an independent global folder choice.

Conversation Files requests use `/api/threads/:id/files` and `/api/threads/:id/file`; their directory is resolved by the server. Project endpoints remain available for uncreated drafts and existing API callers. Changes continues to show the selected native turn's patch; Files shows the project's current working tree.

Before creating a conversation, sending/reviewing/steering work, branching, uploading an image, or dispatching a queued task, Codes verifies the relevant registered directory. Ordinary turns and reviews explicitly use that project working directory. A registration whose path has been retargeted through a different symlink is unavailable until the original directory is restored or the owner selects another registered project. Codes does not silently change an existing conversation's directory.

| Condition                                                   | Behavior                                                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directory missing, moved, replaced by a file, or redirected | `DIRECTORY_UNAVAILABLE` (409); preserve registration, history and settings; block new execution and filesystem access.                            |
| Directory search permission denied                          | `DIRECTORY_ACCESS` (403); retain the directory and report the access problem.                                                                     |
| Individual file missing or inaccessible                     | `FILE_NOT_FOUND` (404) or `FILE_ACCESS` (403); do not describe this as an empty directory.                                                        |
| Native conversation directory disagrees with registration   | `PROJECT_OWNERSHIP` (403); refuse mixed directory context.                                                                                        |
| Waiting queue loses its directory                           | Pause before claiming its next entry; retain its text, attachments, settings and identity. Restore the directory and explicitly resume the queue. |

Use **Retry directory** after restoring a path or permissions. History and historical change patches remain available when the registered directory is absent. An existing `CODES_PROJECT_ROOT` registration also survives startup with that path missing; a new invalid registration still fails explicitly. Reading an already stored operation receipt does not dispatch work again.

This is a preflight consistency check, not protection against a local process changing the filesystem between validation and execution. Two conversations in the same project share its current files. Native sandbox/approval rules remain authoritative for tool access; explicit Git worktrees can provide file isolation in a later feature.

## Evidence and acceptance

The baseline audit against `d86cb9d` verified that normal project switching kept files, patches and attachments separate, but simulating B's conversation with a stale global A selection displayed B's text with A's file. Missing directories retained simulator history, while file access returned a generic 500 and text-only simulator admission still succeeded. These findings motivated the ownership and health checks above; they were not a claim that ordinary project switching already mixed files.

Regressions for this change cover same-named files in two directories, native ownership mismatches, stale browser selections, malformed per-project recent views, last-conversation/draft restoration, independent settings, background tasks and queues, missing-directory recovery, startup with a missing registered project, and single/multiple/empty project layouts. Simulator evidence and native metadata checks are separate from live model, physical-phone and production acceptance. See [acceptance](acceptance.md) for actual results.

## Client reference

The official [Projects and chats](https://learn.chatgpt.com/docs/projects) documentation distinguishes desktop project organization, IDE host-workspace context, and CLI working directories. Codes keeps its own lightweight project layer for the self-hosted browser. The official [environment modes](https://learn.chatgpt.com/docs/environments/modes) distinguish local execution, worktrees and cloud environments; this implementation remains local. These references were reviewed on 2026-11-19 and do not establish complete UI parity.
