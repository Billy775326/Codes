# Changelog

## [Unreleased]

### Removed

- Remove the conversation row's actions drawer and Copy link button. Existing conversation links still open in their registered projects.

- Remove the preview-only global task write-root policy and its forced permission, network, temporary-directory and tool overrides. Restore the existing native conversation permission presets and approval callbacks while preserving saved conversation/default settings and the Files / Changes interface. Retired `CODES_TASK_WRITE_ROOT` and `task-policy.json` configuration no longer applies.

### Added

- Edit the current project's root AGENTS.md in Settings. Saving checks for edits made on disk since the file was opened.

- Resize desktop navigation and project panels by dragging their inner edges or using the arrow keys while the divider has focus. Each width is saved in the browser.

- Reload Codes from the workspace header. Restore the selected conversation and saved draft after reload.

- Toggle hidden files in Files to browse, preview, and attach dotfiles in the selected project. Hidden entries are off by default.

- Archive and restore projects from the sidebar, including projects with no active conversations. In the archive view, browse a project's active and archived chats without changing individual conversation states.
- Choose English or Simplified Chinese in Settings → Appearance. English is the default, and the selection is saved in the current browser.
- Enable optional browser notifications for task results, approvals and questions while the workspace is open in the background.
- Save native request timeout and Code-mode questions in Runtime settings. Review the active configuration and apply changes on the next restart.
- Export saved network configuration and import it into the Network & access form for review before saving.
- Switch between light and dark themes directly from the workspace toolbar.
- Show asynchronous Codex questions in the original turn and mark the corresponding conversation in the sidebar. Answer during the task or after it ends, or skip without stopping the task.
- Choose Cloudflare Access in Network & access. Validate signed Access assertions before serving the workspace, retain Codes token sign-in, and close event streams when the Access token expires.
- Configure the loopback listener, port, and allowed browser addresses in Network & access. Saved settings apply after restart. Keep Codes token sign-in for local, Tailscale, and Access-protected proxy entry points.
- Turn off automatic scrolling as replies arrive, retry a failed browser settings save, and separately restore browser settings and new-conversation defaults.
- Rename and pin projects from their sidebar cards, remember each card's open state, and search by project or conversation name.
- Preview project PNG, JPEG, and WebP files in Files or through Markdown image references. Open a sandboxed visual preview for HTML source files and HTML in Codex replies.
- Prepare maintenance from Session status to pause new tasks and queue dispatch while existing work finishes. The pause expires after five minutes and can be canceled.

- Add Approve for me to conversation permissions and new-conversation defaults using native Auto-review within the workspace sandbox. Explicitly restore manual review for other presets, honor managed restrictions, and display native review outcomes when supplied.
- Show native context-compaction progress and completion without ending the current task or dispatching queued work. Restore progress on browser reconnect and clear it on terminal outcomes/runtime loss.

- Save permissions, model, reasoning effort, Fast, and mode independently for each conversation as soon as they change. Add server-backed New conversation defaults to the settings modal, with serialized saves, revision conflict recovery, and persistent choices across switching, reload, and restart. Running tasks and existing queue entries keep their captured settings.

- Paste or choose image attachments in the composer, with previews, removal, image-only messages, queue previews, and native immediate additions. Keep image bytes outside conversation snapshots, validate supported model input, and block dispatch until uploads finish. PNG, JPEG, and WebP are supported, with four combined attachments and 8 MiB per image; see [image limits and retention](docs/image-attachments.md).

- Document the project philosophy, “codex no cli = codes”, with English and Chinese explanations.

- Add Fast and Execution / Plan controls to the model/reasoning popup, with the selected model and effective reasoning effort visible in its trigger. Fast uses native service-tier overrides independently of reasoning, persists with task/queue settings, and is unavailable when the selected model does not advertise support. Standard explicitly overrides inherited Fast for new tasks.

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

- Browse native conversations with title search, date groups, and cursor pagination beyond the local summary window. Archived conversations retain their history and must be restored before sending.
- Protect running and uncertain executions from archiving, and retain a protected state when an archive acknowledgement is lost.

- Introduce a single-owner Linux web workspace with project conversations, streaming replies, host-side Codex CLI execution, and a responsive desktop/mobile interface.
- Add explicit per-request approval and question flows, read-only file selections as context, and a current-turn change viewer.
- Preserve operation receipts across browser disconnections and service restarts; uncertain execution blocks a second send until a terminal result is confirmed.
- Add bounded history pagination, event replay, request deadlines, and a clearly labeled simulation runtime for isolated acceptance.
- Add workspace-token sign-in, same-origin mutation checks, and loopback binding by default.

### Changed

- Keep the project card disclosure beside its name in both states. The chevron indicates whether conversations are visible and keeps keyboard focus when toggled.

- Use 14 px as the default conversation and code text size.

- Put the collapse control beside the Codes logo on desktop and mobile. Reopen the sidebar from the conversation header. Close Files and Changes from the far right of the project panel header.

- Show shorter descriptions and a clear selected mark in the conversation permission picker. Highlight unrestricted access and explain when Auto-review is unavailable.

- Shorten hover hints and help text throughout the workspace. Show full titles when clipped and keep actionable warnings, shortcuts, and recovery instructions.

- Group composer buttons by purpose and put Queue, Add now and Stop together while a task runs. Highlight the action used by the send shortcut, with accessible labels and hints for each action.

- Prefill Add project with the configured startup project directory, or the Codes installation directory when unset.

- Show one three-dot task indicator in the conversation, with distinct colors for running, questions, approvals, reconnecting and unknown results. Only running animates and reduced-motion preferences are respected.
- Expand project actions inside each project card. Confirm project archiving and edit queued messages directly from their cards.
- Select a file range explicitly, including on touchscreens. Remember the Changes layout and copy individual code blocks from finished replies.
- Expand each work-history segment independently around questions; terminal groups still start collapsed.

- Rename conversations in the workspace header. Archive or restore from the sidebar row and confirm archiving in a dialog that names the conversation and explains restoration.

- Open external web links in chat in a new tab and keep workspace links in the current tab.

- Use compact icon rows for project and conversation actions in the sidebar. Show action names on hover and keyboard focus, and keep labels visible on touch devices.

- Show hover and keyboard hints for reply and branch actions, the model and permission pickers, and alternate delivery actions. Enlarge reply controls on narrow screens and label the error close action on hover.

- Group toolbar actions by task. Use named icons for patch layout, viewed state, file navigation, configuration transfer, and compact attachment controls. Keep visible labels for sending, approvals, recovery, and file attachment scope.

- Make live replies and sidebar activity easier to spot with a brighter running cursor and larger indicators for active tasks, approvals, and questions. Keep indicators static while reconnecting or when reduced motion is enabled.

- Make the indicator at the end of an in-progress Codex reply larger and easier to see in both themes.
- Fit queue editing controls on narrow screens with labeled icons for saving, canceling, stopping, and pausing or resuming the queue.

- Move Add project above the sidebar cards, accept an optional display name, and keep form errors and retry input in the add-project dialog. Reuse an existing project when the path resolves to a registered directory.
- Replace the Chats dropdown with an archive toggle, shorten the project action labels, and show message destination and stop behavior in the shared tooltips.
- Use icon-only workspace tools with hover and keyboard hints. Keep permission, model, and follow-up labels visible. Give changes, code review, link copying, and message delivery distinct icons.
- Use shorter setting labels and fit dropdowns to their selected values in Settings, the composer, and the conversation sidebar. Expose permission preset names and descriptions separately to assistive technology.
- Render Codex replies as Markdown as they stream, with bounded parsing for long replies and image and HTML previews available when the reply finishes.
- Pulse the sidebar dot for running conversations while live updates are connected. Keep it static when reconnecting or when reduced motion is enabled.
- Remove the separate status line at the bottom of the conversation timeline.
- Open one composer attachment menu to upload local text files or images, or to choose files from the current project.
- Restore sidebar order and folded cards at first paint, and show a conversation loading state while reopening saved chats.
- Use compact project cards with no date-group headings and less space between conversation rows.
- Move projects with recently updated conversations to the top of the sidebar, including live updates from other projects. Keep empty projects at the bottom.
- Show only the name for empty projects and projects inactive for three days by default. Open a project card to see its conversations, and search across collapsed cards.

- Show all registered projects as sidebar cards with their own conversations and new-chat controls, using one shared search and archive filter.

- Show completion status in the conversation list and add turn usage, average output speed and local completion time to the latest task summary when available.
- Use English labels, dates, and numbers throughout the workspace interface, with timestamps in the browser's local time zone.

- Retain lightweight project + conversation navigation: show a directory label for one project, a selector for multiple projects, and one empty-state Add project action. Remember each project's last conversation/new-draft view while retaining independent text drafts, settings and background execution.

- Organize navigation around project context, a conversation-view dropdown, compact status-aware rows, and workspace controls. Preserve archive and recovery actions without duplicate controls.
- Apply the owner-provided Codes V3 logo to navigation, sign-in and the browser favicon using the original light/dark SVG assets.

- Reorganize conversation navigation into Chats / Archived and readable title/status/time rows. Show approvals, questions, uncertain results and queue pause/failure conditions; retain saved states during disconnection and refresh the current list page when live updates resume. Reconcile validated native status metadata without treating idle/unloaded as completion or clearing uncertain receipts.

- Expand chat text sizes to 12–24px and code text sizes to 10–20px in 1px steps. Preview immediately and retain new choices after reload, alongside existing choices and Default.

- Reduce default conversation text to 15px, workspace text to 14px, and desktop composer text to 15px. Retain 16px phone input text and existing explicit chat/code size preferences.

- Simplify sign-in, project navigation, conversation headings, and composer chrome. Keep starter actions in the conversation menu and detailed delivery scope on accessible controls. Share theme and modal primitives across login, workspace, and confirmation dialogs, including consistent keyboard focus and background locking.

- Keep queued follow-ups in a compact card above the composer, group editing under message actions, and edit waiting text in the input area while preserving the original draft. Editing pauses the queue; saving does not send it or alter its model, permissions, or attachments.

- Replace the composer Code dropdown with an explicit Codex permissions menu for Read only, Ask for approval, and Full access. Apply both sandbox and approval policies to subsequent tasks; keep Plan available through `/plan` and a visible exit marker.

- Unify the composer focus border and control alignment, keep the model picker outside clipping bounds, and place idle project/delivery/keyboard hints on one footer row. Preserve full task-delivery guidance during active or queued work.

- Organize the settings dialog into appearance and interaction groups with a fixed header/footer, scrollable phone layout, optional shortcut details, and immediate chat/code font previews. Preserve existing defaults and preferences, and report browser storage failures.

- Show Copy, Reply and Branch once per turn below its last loaded assistant reply, remove empty toolbar space from progress messages, and tighten spacing around command summaries.

- Increase workspace text, line spacing and controls with fixed readable defaults. Use softer dark gray surfaces, clearer secondary text and two-row controls for narrow composers. Retire the preview Display size option and ignore its saved value while preserving other browser preferences.

- Organize the browser workspace around persistent desktop project/conversation navigation, central chat and right-side file/change previews. Keep IDE-style model/reasoning menus, edited-file cards and copy actions, with saved dark/light/system themes. Mobile drawers contain keyboard focus and return to typing after attaching context.

- Set the default workspace port to 6670. Set `CODES_PORT` to use a different listener port.
- Improve the sign-in layout for desktop and mobile, with clearer token input, visibility controls, token-location help, and retry after a failed initial connection check.

### Fixed

- Show one asynchronous question card when legacy history and live events use different IDs for the same request, including when history renumbers the item. Preserve confirmed answers on the original question.

- Pause waiting messages for new failures, interruptions, or uncertain receipts. Preserve explicit pauses and avoid applying old failures to a fresh queue.

- Open absolute project-file links from Codex replies in the Files preview, including plain HTML anchors and Markdown file links.

- Restore keyboard focus to the composer menu button when Escape dismisses a model or reasoning picker opened by a slash command.

- Keep the workspace at the viewport boundary while a long conversation is running.

- Keep the header's conversation menu in the viewport on phones and close project menus before closing navigation with Escape.
- Preserve unsaved Network & access and Runtime edits while switching settings sections, and confirm discarding them when closing.
- Check queue receipts after restoring the selected conversation and preserve newer draft edits during recovery.

- Show answers directly on their original Codex question card. Keep ordinary follow-up receipts separate, and offer an answer-specific status check when delivery is uncertain.

- Separate immediate follow-up acceptance from task completion. A confirmed follow-up no longer offers a result check while its task is still running, and an unconfirmed follow-up can be checked without a misleading task lock warning.

- Keep the light palette visible when Chrome auto-darkening is enabled with a dark system preference. Update the open theme shortcut tooltip when the system theme changes.

- Keep the Codes wordmark and sidebar search placeholder readable on dark backgrounds, including when browser colors differ from the app theme.

- Wrap long diff lines and hunk headers within both Changes layouts while keeping line numbers and before/after columns aligned.

- Wrap long source lines inside Files so their full text is readable on desktop and phones while preserving source line numbers and selection.

- Explain when an HTML entry page needs JavaScript to render instead of opening a blank static preview. Keep the source available in Files.

- Give Files a full-height folder list, a focused preview on narrow screens, and paged source lines for large files. Clear stale entries and previews during navigation and offer local retry for failed reads.

- Keep resolved Codex questions in their original turns when viewing paginated conversation history.

- Show readable answer previews in follow-up receipts and pending messages for asynchronous Codex questions.

- Keep recorded token usage and completion metrics beside the original reply’s actions across later turns and service restarts.

- Show optional questions, simultaneous approval and answer requests, responses being submitted, context compaction and expired questions in the conversation sidebar.

- Keep terminal activities collapsed in groups when opening a turn’s work history.

- Explain when a pending Codex question expired after a runtime restart and keep the task result check available.

- Show native questions and imported answers inside their conversation turns, where they remain visible when work history is collapsed.

- Recognize native conversation writer contention when another client still owns an imported thread. Keep readable history and the prior task outcome, retain the unsent draft, and offer explicit availability checks or a separate branch without replaying rejected work.
- Display answered Covro question envelopes as readable question/answer text while preserving native identity and stored history; old callback payloads are not live question forms.

- Open imported legacy Codex conversations through bounded full turn pages rather than unsupported item pagination. Preserve history cursors, existing display limits, archived records and the original native files.

- Bind conversation file previews and task working directories to server-verified project ownership, repairing stale browser project selections. Preserve history when a registered directory is missing, including after service restart; expose directory/file errors and explicit recovery, and pause queued work before claiming it.

- Reconcile English/Chinese feature documentation, schema 4 migration notes, bounded history behavior, and owner-approved V3 logo status; keep proposed conversation-first navigation separate from implemented behavior.

- Restore cold-loading conversations containing multi-megabyte native tool results. Read turn metadata without eager items, fetch one history item per response, and decode native frames up to 16 MiB with one concatenation per frame. Browser history and snapshot limits remain bounded.

- Remove queued messages and their sidebar counts immediately after native acceptance, while retaining private execution receipts. Keep later messages waiting until the current task finishes; stopping or failing a delivered task pauses the remaining queue without putting the delivered message back. Preserve unconfirmed-delivery checks and confirmed delivery state across restart.

- Retain history-confirmed outcomes for imported conversations when refreshing the sidebar, preserving uncertain execution receipts and concurrent title/archive updates.

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
