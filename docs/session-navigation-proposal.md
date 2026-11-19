# Conversation-first navigation: audit and proposal

**Status: proposed, not implemented.** This is a design review for the single-owner Linux Codes workspace. The native approval/compaction work does not remove or change the current project picker.

## Client reference and recommended scope

The official [Projects and chats](https://learn.chatgpt.com/docs/projects) documentation distinguishes desktop projects, IDE workspace context, and CLI working directories. The desktop client has project organization; the IDE uses its host workspace. Removing a visible project selector does not remove the execution directory. The official [environment modes](https://learn.chatgpt.com/docs/environments/modes) also distinguish local execution, isolated Git worktrees, and cloud environments. Reviewed on 2026-11-19; these references do not establish complete UI parity.

For Codes, use **conversation-first navigation with a native working directory per conversation**. Keep one unified conversation list and right-side Files / Changes. Move directory selection into new-conversation setup, with recent server directories as shortcuts. The directory is context, not an additional Codes write restriction; native permissions continue to control access.

A desktop project's full management layer and cloud environment controls would add little to this single-owner local workflow. Git worktree creation can be an explicit later feature for file isolation. Two conversations using the same directory share its current working tree; separate transcripts do not create separate file copies.

## Baseline verification

An isolated browser/simulator audit against commit `d86cb9d` used two synthetic directories and conversations, same-named source files, native patch fixtures, and an uploaded image. It made zero model requests, did not alter port 6670, and retained the real database counts. These findings test the proposed acceptance criteria; failures below are not claims that normal project switching already mixes files.

| Criterion                                          | Baseline finding                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing project switching                         | Passed: files, patches, and unsent file/image attachments stayed with the selected project; another project could not retrieve the uploaded image reference.                               |
| Unified conversation list                          | Not met: a selected project filters out the other directory's conversation.                                                                                                                |
| Conversation alone determines Files                | Not met: simulating a B conversation selection while retaining global project A showed B text and A's same-named file. This models removing the project selector without fixing ownership. |
| Missing directory keeps history readable           | Passed for stored simulator history.                                                                                                                                                       |
| Missing directory gives an actionable file error   | Not met: the file endpoint returned generic `500 INTERNAL_ERROR`.                                                                                                                          |
| Missing directory blocks execution before dispatch | Not met in simulator admission: a text-only send returned 200 after fixture-directory removal. No real native/model execution was attempted; eventual native behavior is unverified.       |
| Empty installation can begin a conversation        | Not met: New conversation was disabled until adding a project; Add project appeared twice.                                                                                                 |
| Preserve legacy directory registrations            | Design requirement only; no new migration has been implemented or accepted.                                                                                                                |

## Proposed interaction

| Area                       | Recommended behavior                                                                                                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar                    | New conversation, search, Chats / Archived, paginated conversation rows and existing status/recovery actions. No permanent project selector or registration CRUD.                                                                                                                                                 |
| New conversation           | Compact **Working directory** control for a server path, with recent directories and explicit selection. Prefer the current conversation's directory, then the configured default; require selection if neither is available. Show the chosen path before sending. Never assume the Codes installation directory. |
| Existing conversation      | Native conversation directory is authoritative. Show it in conversation details/context. Do not silently change it through global navigation; open a new conversation to use another directory in the first implementation.                                                                                       |
| Preferences                | Keep independent per-conversation model, reasoning, mode and permission choices. New conversations use saved defaults; directory inheritance must not inherit a previous conversation's elevated permissions.                                                                                                     |
| Files / Changes            | Resolve the directory from conversation identity on the server. Files show the current working tree; Changes show the selected native turn's patches. Uploaded-image references and draft context must use the same owner resolution.                                                                             |
| Missing or moved directory | Preserve history, return an explicit directory-unavailable error, and block filesystem/task admission before execution. Offer retry or a new conversation with another directory; never silently fall back to another path.                                                                                       |

Keep the browser's selected conversation as the navigation source. Existing `projectId` can remain an internal directory registration and compatibility mapping; this proposal does not require clearing the database, moving native transcripts, changing authentication, or reintroducing a global write whitelist.

## Delivery order and acceptance

1. Resolve all conversation context centrally: native directory, files, patches, attachments, and request cancellation. Validate the directory before filesystem/turn admission and distinguish missing paths from transient I/O errors. Re-run the cross-directory and missing-path cases first.
2. Expose a metadata-only unified native conversation list with existing cursor/search/archive behavior. Reuse the bounded summary projection and the current single event subscription: summaries already broadcast across conversations, while text stays scoped to the selected conversation. Do not load every row's history or open an event stream per directory.
3. Remove the project selector only after those invariants pass. Add the compact new-conversation directory control, preserving draft scope, saved defaults and old registrations. Verify empty-installation setup, two same-named files, active tasks during switching, stale reads, archive/search pagination, reload/restart, and desktop/phone layouts.

This improves UX by making conversation selection sufficient, DX by centralizing directory ownership, and AX by providing semantic directory controls and explicit recoverable errors. The cost is touching list/context APIs before the visible simplification; deleting controls first would retain the demonstrated ownership conflict. Existing task receipts, approval callbacks, queue semantics, history limits and permission boundaries must remain intact.
