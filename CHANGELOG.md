# Changelog

## [Unreleased]

### Added

- Let Codex request clarification in Code as well as Plan using an application-local feature setting. Distinguish required questions from optional ones, offer explicit Skip for optional requests, and provide keyboard-accessible choices and a composer shortcut to pending questions.
- Preview changes per file with addition/deletion counts, before/after line numbers, unified or side-by-side layouts, revision-specific viewed markers, and read-only file navigation. Inspect earlier loaded turns and proposed patches before file approval.
- Render long patches in 200-row windows and disclose incomplete patches and command output instead of silently presenting clipped previews as complete.
- Steer a running turn with immediate follow-ups or a waiting queue entry's Send now action, keeping durable receipts and protecting unknown results against duplicate execution.
- Select native Plan/Code modes and model-advertised reasoning effort; display native plan steps and session status with context/cumulative token usage.
- Start native Read only code reviews against uncommitted changes, a base branch, a commit or custom instructions, in the current or a separate conversation.
- Save browser Enter/queue/steer/review preferences, invert follow-up behavior with Ctrl/Cmd+Shift+Enter, create a conversation with Ctrl/Cmd+N, and use supported local slash commands.
- Attach entire text files as context as well as line selections, retaining snapshot validation and size limits.
- Back up metadata schemas 1–3 before upgrading to schema 4, preserving projects and receipts while making reviews share the existing task execution lease.

- Install a local `codes` command to start the built workspace from any directory, with a pinned Node executable and the existing checkout data directory.
- Answer native structured questions with option descriptions, custom text when permitted, masked secret fields, and cross-client resolution. Quote a historical message into an editable follow-up draft.
- Queue up to ten messages per conversation, edit or remove waiting entries, and pause/resume sequential execution. Persist queues across browser closure; service restarts, stopped/failed tasks, and unknown outcomes hold the queue for review. Bound broadcast previews while preserving full editable messages.
- Create a native conversation branch through a completed turn, retain source navigation, and start the branch in Read only. Branching preserves later source history, shares current project files, and does not copy queued messages.

- Browse native conversations with title search, date groups, and cursor pagination beyond the local summary window. Rename, archive, and restore conversations from the sidebar; archived conversations retain their history and must be restored before sending.
- Protect running and uncertain executions from archiving, and retain a protected state when an archive acknowledgement is lost.

- Introduce a single-owner Linux web workspace with project conversations, streaming replies, host-side Codex CLI execution, and a responsive desktop/mobile interface.
- Add explicit per-request approval and question flows, read-only file selections as context, and a current-turn change viewer.
- Preserve operation receipts across browser disconnections and service restarts; uncertain execution blocks a second send until a terminal result is confirmed.
- Add bounded history pagination, event replay, request deadlines, and a clearly labeled simulation runtime for isolated acceptance.
- Add workspace-token sign-in, same-origin mutation checks, and loopback binding by default.

### Changed

- Set the default workspace port to 6670. Set `CODES_PORT` to use a different listener port.
- Improve the sign-in layout for desktop and mobile, with clearer token input, visibility controls, token-location help, and retry after a failed initial connection check.

### Fixed

- Resume the working status after a native question or approval is resolved, reject stale question callbacks, and ignore diff notifications for another turn.
- Preserve a newer follow-up draft and its attachments when an earlier send, queue or steer acknowledgement arrives. Carry text typed during new-conversation creation into the selected conversation.

- Preserve the loaded history when reselecting the current conversation, and prevent older list responses from replacing a new task title or a live rename. Seed sidebar metadata from the selected snapshot so a subscription handoff cannot leave a working conversation labeled Untitled.

- Open conversations with dense tool history by reducing the number of turns per history page when the combined page exceeds display limits. Older-page cursors remain aligned with the returned records; a single oversized turn still reports an explicit limit.
