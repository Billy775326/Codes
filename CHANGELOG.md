# Changelog

## [Unreleased]

### Added

#### Workspace and execution

- Run a single-owner Codex web workspace on Linux with the host's CLI login, a simulated runtime for testing, and a foreground `codes` launcher.
- Group native chats in project cards. Search titles, browse native pages, remember the last view per project, and rename, pin, archive, or restore projects. Native conversation rename, archive, and restore retain history.
- Send, queue, edit waiting messages, pause or resume dispatch, add a draft or waiting message to the active turn, and branch through a completed turn. Durable receipts protect work after disconnects and restarts.
- Show native Code and Plan questions, including optional input, custom and masked answers, and answer status. Confirmed asynchronous answers remain on the original card.
- Choose model, reasoning, Fast, permissions, and Plan or Execution using Codex configuration. Use native Auto-review, native code reviews, and reported task-plan and compaction state when supported.
- Show per-turn work history, edited-file cards, native timestamps and usage, and a pinned turn-message summary with a jump to the original prompt.
- Recall recent user prompts with Up and Down, quote a historical reply, copy code blocks, and use keyboard delivery shortcuts and native-backed local commands.
- Restore cached recent transcripts while refreshing the selected conversation. Load older and newer history while preserving the reading position.

#### Files and review

- Upload to project folders, create folders, download files, copy paths, and reference an existing file from the composer. Changed file references hold queued work for review.
- Upload UTF-8 context, supported native raster images, and local documents or archives through the composer. Document originals are saved under `codes-attachments/` with a reference in the draft.
- Preview Word body text, PDF pages, PNG/JPEG/WebP, HTML, and source. Open local file links and visualization references in Files or a separate read-only preview. Explicit paths outside normal project scope show a warning.
- Show native patches in unified or side-by-side layouts with file counts, line numbers, viewed markers, and paginated rows. Attach a whole text file or an explicit line range.

#### Settings and operations

- Set English or Simplified Chinese, theme, conversation and code font sizes, sidebar widths, hidden-file visibility, automatic scrolling, and browser notifications.
- Configure the new-project directory, native execution options, Codex global instructions, the listener and allowed origins, sign-in lifetime, network export/import, and the native RPC deadline.
- Use a private workspace token for Local / Tailscale or add a verified Cloudflare Access assertion. Rotate the file-backed token while existing server tasks continue.
- Prepare maintenance, collect bounded connection diagnostics, download a SQLite backup, and stage a same-schema offline restore. Switch compatible web assets without restarting the backend.
- Discover required and optional App Server capabilities from the installed CLI and display the actual runtime version.

### Changed

- Use native Codex configuration for effective execution settings. Schema 6 retains legacy metadata and holds affected queue entries for review. Startup makes a private backup before migrating a supported older schema.
- Add follow-ups to the current turn from the desktop send shortcut by default when eligible. Use Tab to queue or change the default in **Settings → General → Interaction**.
- Keep workspace controls compact with named icons, keyboard and hover cues, and direct archive, restore, sign-out, status, and review actions. Required choices, task states, and recovery actions remain explicit.
- Keep settings in browser, workspace, and server scopes. Use a branded sign-in form and print the access-token file path only when the server generates it.
- Render project cards in activity order, with inactive projects folded by default and state retained across reload. Keep desktop navigation and the selected context on the sides of the conversation.
- Open external web links in new tabs. The default listener remains loopback on port 6670 unless the environment or saved settings choose another port.

### Fixed

- Preserve newer text and attachments when earlier send, queue, steering, or conversation-creation acknowledgements arrive. Keep the original prompt and confirmed follow-ups in their native turn.
- Resolve confirmed questions and imported legacy answers in their originating cards. Keep distinct question requests separate, mark expired callbacks, and check uncertain answers independently of task delivery.
- Keep queued messages and their counts aligned with native acceptance. Scope automatic queue pauses to current failures, stops, configuration changes, and uncertain results.
- Preserve verified project ownership, retained history, and drafts when switching, opening shared links, or reconnecting. Ignore stale list and history responses that would overwrite newer activity or metadata.
- Handle active-writer contention when opening native history from another client. Preserve the draft and prior outcome and offer an availability check or branch.
- Read bounded legacy history and very large native tool results through the appropriate protocol path. Prioritize the selected conversation and cancel stale reads.
- Explain connection and transfer failures with relevant recovery actions. Return an expired session to sign-in, negotiate gzip for large JSON reads, and release unneeded event streams when a tab is hidden.
- Fix blank content around code blocks, empty HTML previews for JavaScript shells, and file links to hidden or different projects. Wrap long source and diff lines while keeping line and column context.
- Keep popups in the viewport, restore focus after dismissal, and preserve settings edits across section changes. Improve dark and light control contrast and mobile action layout.
- Keep native usage, completion time, and elapsed work visible with the corresponding turn across later activity and service restarts.

### Removed

- Remove the preview-only global task write-root policy. Codex native sandbox and approval configuration governs tools.
- Remove the duplicate confirmation above the composer for accepted same-turn additions. Uncertain deliveries retain their recovery control.
- Remove redundant conversation row actions and decorative help text. Existing conversation links continue to open in their registered project.

See the [documentation index](docs/README.md) for current behavior, [acceptance](docs/acceptance.md) for recorded verification, and the [earlier development log](https://github.com/Billy775326/Codes/blob/dc327e453425e74eff529aba1aab04af4f0505ae/CHANGELOG.md) for individual changes.
