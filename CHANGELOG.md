# Changelog

## [Unreleased]

### Added

- Show native turn start times below the first user message and finish times beside final-reply actions, with local dates and a full timestamp/timezone tooltip. Leave unavailable historical and intermediate-item times unset.

- Group each native turn into one work-history disclosure containing intermediate commentary and tool/integration activity. Completed work collapses by default; final answers, one edited-files card and one action row stay visible. Preserve manual disclosure choices through updates, show failures while collapsed, and display elapsed time only when native timing is available. Legacy turns without phases retain their last completed assistant reply as the answer.

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

- Show Copy, Reply and Branch once per turn below its last loaded assistant reply, remove empty toolbar space from progress messages, and tighten spacing around command summaries.

- Increase workspace text, line spacing and controls with fixed readable defaults. Use softer dark gray surfaces, clearer secondary text and two-row controls for narrow composers. Retire the preview Display size option and ignore its saved value while preserving other browser preferences.

- Organize the browser workspace around persistent desktop project/conversation navigation, central chat and right-side file/change previews. Keep IDE-style model/reasoning menus, edited-file cards and copy actions, with saved dark/light/system themes. Mobile drawers contain keyboard focus and return to typing after attaching context.

- Set the default workspace port to 6670. Set `CODES_PORT` to use a different listener port.
- Improve the sign-in layout for desktop and mobile, with clearer token input, visibility controls, token-location help, and retry after a failed initial connection check.

### Fixed

- Compress large JSON responses when supported and declare their exact transfer length. Let progressing read downloads finish beyond 35 seconds, with a 35-second inactivity deadline and a two-minute overall bound, instead of repeatedly discarding partial conversation history. Keep write deadlines and duplicate-execution protection unchanged; interrupted downloads remain retryable.

- Show snapshot connection failures immediately during bounded retry, distinguish HTTP/proxy responses, invalid JSON and request deadlines from an unreachable service, and reserve uncertain-execution warnings for writes.
- Verify stored terminal operation receipts when the selected snapshot reconnects, and refresh the subscription after Check result proves a browser request was not recorded. Preserve unknown receipts and never automatically resend tasks.
- Release event connections while a tab is hidden and refresh its snapshot on return. Keep sending unavailable until the current subscription is connected; server tasks and queues continue independently.

- Scroll continuously through older and newer native history with automatic bidirectional loading, stable turn anchors, bounded page retention and explicit retry after a failed page read. Keep latest jumping optional and preserve live updates while reading.
- Make Send, Queue, Add now and Stop labels visible with delivery timing and edit-scope guidance. Lock queue edits once dispatch begins, preserving unsubmitted local text if an entry starts or disappears; explain quoted replies and conversation branches.

- Keep the latest live conversation cache separate from earlier-history browsing, so loading older pages cannot discard newer replies. Offer a persistent Back to latest action with a new-activity indicator, continue paging at the display limit, preserve drafts, and cancel stale history requests on navigation.

- Return expired browser sessions to sign-in instead of leaving conversation snapshots, questions or sidebar requests stuck reconnecting. Preserve selected conversations and composer drafts for sign-in recovery, show permanent snapshot failures with explicit retry, and block sending until the selected history/task status loads.

- Keep unsent new-conversation drafts separate per project, migrate the previous unscoped draft without overwriting existing conversation drafts, and cancel stale file reads when navigating between projects or conversations.

- Show a concise data-directory/lock-owner message when `codes` is started again, preserving exit status 1 and the existing process instead of printing a startup stack trace.
- Resume the working status after a native question or approval is resolved, reject stale question callbacks, and ignore diff notifications for another turn.
- Preserve a newer follow-up draft and its attachments when an earlier send, queue or steer acknowledgement arrives. Carry text typed during new-conversation creation into the selected conversation.

- Preserve the loaded history when reselecting the current conversation, and prevent older list responses from replacing a new task title or a live rename. Seed sidebar metadata from the selected snapshot so a subscription handoff cannot leave a working conversation labeled Untitled.

- Open conversations with dense tool history by reducing the number of turns per history page when the combined page exceeds display limits. Older-page cursors remain aligned with the returned records; a single oversized turn still reports an explicit limit.
