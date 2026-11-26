# Project and conversation navigation

This adopted design records how the sidebar, browser selection, and server agree on the directory for each native conversation. For day-to-day actions, use [Projects and chats](conversations.md).

## Layout and navigation

A registered directory has a card with the project's chats and its new-conversation action. The toolbar contains **Add project**, search, and archive navigation. A project remembers its last chat or explicit new-conversation view in the current browser.

Project views use the bounded `codes.project-views` browser store, with up to 20 recent entries. Text drafts are kept separately per conversation or new project draft. Existing selection keys remain readable. Selecting another project or conversation closes context previews and cancels stale reads. Active server work continues.

## Ownership and directory health

Codes verifies a conversation's native working directory against its registered project. The conversation snapshot includes its small project context and directory health. The browser restores that ownership before using file actions, even when the previous selection belonged to another project.

Conversation-scoped text context requests resolve their directory through the server's verified conversation association. The file management and preview APIs use that verified project in the workspace. The Changes view shows the selected native turn's patches. Files reads the current filesystem.

| Condition                                         | Recovery behavior                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Directory missing, replaced, moved, or redirected | `DIRECTORY_UNAVAILABLE`. Restore the registered canonical path and select **Retry directory**.     |
| Directory access denied                           | `DIRECTORY_ACCESS`. Restore directory permissions for the service account and retry.               |
| Individual file missing or unreadable             | `FILE_NOT_FOUND` or `FILE_ACCESS`. Recover or select the file again.                               |
| Native directory disagrees with the registration  | `PROJECT_OWNERSHIP`. Correct the original directory association before using file or task actions. |
| Waiting queue loses its directory                 | Waiting data stays intact. Restore the directory and explicitly resume.                            |

History and loaded historical changes remain readable when the directory is unavailable. An existing startup registration can survive a temporarily missing path. Choosing a different project opens that project's own conversation. Files and execution in the same project share its current directory, subject to native permissions. [Operations recovery](operations.md#project-directory-recovery)

## Evidence and acceptance

The audit against `d86cb9d` reproduced a stale browser selection pairing one conversation with another project's file. Directory tests also found different error paths for file reads and execution. Those cases led to the verified snapshot context, directory preflight, and queue protections documented here.

Regression coverage includes same-named files in two projects, native directory disagreement, stale selection repair, missing-directory recovery, and background work across project switches. [Recorded acceptance](acceptance.md#project-and-conversation-context-acceptance)

## Client reference

The Codex clients distinguish project organization from the working directory used for execution. Codes adds a browser project layer for a self-hosted local server. [Projects and chats](https://learn.chatgpt.com/docs/projects)
