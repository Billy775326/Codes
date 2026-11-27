# Changelog

## [Unreleased]

## [0.2.1] - 2026-11-27

### Added

- Prepopulate Allowed addresses with the host's IP addresses on fresh installations that use the default browser origins.

### Fixed

- Show the most recent loaded patch when the last turn has none, and explain when a turn has no recorded patch.

## [0.2.0] - 2026-11-27

### Added

- Choose the initial browser language and port during interactive installation. The installer displays the new workspace token and replaces it when reinstalling the same version.

- Start Codex device-code sign-in from the workspace when a compatible App Server reports a signed-out account.

- Open Connection status to check the browser, Codex runtime, and Codex account independently. A slow conversation can load while the browser remains connected. Signed-out users can keep editing drafts, and waiting messages stay queued until the owner resumes dispatch.

### Changed

- Use a softer neutral palette in light mode, with blue-gray selection highlights and slightly brighter input surfaces.

### Fixed

- Keep the full title row available on phones by placing the connection status alongside toolbar controls.
- Describe what sending does when the composer is empty, and show the relevant connection or account requirement when execution is unavailable.
- Open new drafts in the Codex App Server's startup directory by default while loading native conversations in the sidebar. Codex creates the native conversation on first send.

## [0.1.0] - 2026-11-26

### Added

- Install the Linux x64 or ARM64 release with one command. Release packages include Node.js and verify the download checksum before installation.

#### Workspace and execution

- Run a single-owner Codex web workspace on Linux with the host's CLI login, a simulated runtime for testing, and a foreground `codes` launcher.
- Browse native Codex conversations across working directories. Filter active and archived conversations, search titles, and save a sort preference for recent updates or newest creations. Native rename, archive, and restore keep the same conversation ID.
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

- Use `codes start`, `codes status`, `codes stop`, and `codes restart` to manage a workspace from the terminal.
- Use `codes help` for command usage, `codes doctor` for startup and listener checks, and `codes logs -f` for live background logs.
- Configure send and Tab behavior under **Keyboard**, choose whether new conversations ask for a directory, and restore both sidebar widths from **Layout**.
- Export browser preferences and sidebar widths as JSON. Review a valid import before applying it in this browser.

- Set English or Simplified Chinese, theme, conversation and code font sizes, sidebar widths, hidden-file visibility, automatic scrolling, and browser notifications.
- Configure native execution options, Codex global instructions, the listener and allowed origins, sign-in lifetime, network export/import, and the native RPC deadline.
- Use a private workspace token for Local / Tailscale or add a verified Cloudflare Access assertion. Rotate the file-backed token while existing server tasks continue.
- Prepare maintenance, collect bounded connection diagnostics, download a SQLite backup, and stage a same-schema offline restore. Switch compatible web assets without restarting the backend.
- Discover required and optional App Server capabilities from the installed CLI and display the actual runtime version.

### Changed

- Reopen recent folders, small text previews, and the first conversation list page while they refresh. Restore the last reading position when returning to a conversation and share Codex model and mode catalogs across tabs.
- Group settings by function and show the selected page title above its sections. Collect database backups and restores, network configuration files, and browser preference files under **Backup & restore**. Align controls with their labels and stack dropdowns and numeric fields on narrow panels.

- Use native Codex configuration for effective execution settings. Schema 6 retains legacy metadata and holds affected queue entries for review. Startup makes a private backup before migrating a supported older schema.
- Add follow-ups to the current turn from the desktop send shortcut by default when eligible. Use Tab to queue or change the default in **Settings → General → Interaction**.
- Keep workspace controls compact with named icons, keyboard and hover cues, and direct archive, restore, sign-out, status, and review actions. Required choices, task states, and recovery actions remain explicit.
- Open Files and Changes from one toolbar button and return to the last tab used. Start Codex reviews from Changes.
- Keep room for the conversation and composer by opening the right panel as a drawer when it cannot dock. Narrow file panels switch between the list and preview. Changes scroll independently and use unified patches when space is limited.
- Show a conversation's directory in the sidebar when it differs from the current directory. Hover or focus a row to see the full path.
- Label **New conversation** with a subdued sidebar button, reveal desktop archive actions on selection, hover, or focus, and keep them visible on touch layouts. The sort menu shows and marks the current order. List retry and stream reconnect appear where each failure occurs.
- Keep settings in browser, workspace, and server scopes. Use a branded sign-in form and print the access-token file path only when the server generates it.
- Group maintenance and recovery separately from server settings. Show read-only runtime paths when expanded in connection diagnostics.
- Show settings drafts in navigation and give the instructions editor more room. Save execution, instructions, network, sign-in validity, and CLI settings from the footer, which shows save and restart status.
- Choose a working directory when starting a new conversation. Files and execution follow the native conversation directory. Existing Codes queues and receipts retain their conversation IDs.
- Store new installations in the user data directory. Existing installations continue using their configured directory or detected checkout data.
- Open external web links in new tabs. The default listener remains loopback on port 6670 unless the environment or saved settings choose another port.

### Fixed

- Edit conversation titles in place without moving the main header tools. The editor uses more of the title row when space is tight.
- Keep successful and failed tool output collapsed by default while showing failure counts, questions, approvals, and final replies. Keep the pinned turn-message header on one line with both actions available.

- Keep historical image attachments visible after a conversation changes its native working directory.
- Preserve instructions and CLI setting drafts when reloading after a save conflict. Keep the desktop workspace header aligned on one row.
- Preserve newer text and attachments when earlier send, queue, steering, or conversation-creation acknowledgements arrive. Keep the original prompt and confirmed follow-ups in their native turn.
- Resolve confirmed questions and imported legacy answers in their originating cards. Show native question options once, keep distinct requests separate, mark expired callbacks, and check uncertain answers independently of task delivery.
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
