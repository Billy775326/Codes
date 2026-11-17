# Changelog

## [Unreleased]

### Added

- Browse native conversations with title search, date groups, and cursor pagination beyond the local summary window. Rename, archive, and restore conversations from the sidebar; archived conversations retain their history and must be restored before sending.
- Protect running and uncertain executions from archiving, and retain a protected state when an archive acknowledgement is lost. Back up schema 1 metadata before migrating archive flags to schema 2.

- Introduce a single-owner Linux web workspace with project conversations, streaming replies, host-side Codex CLI execution, and a responsive desktop/mobile interface.
- Add explicit per-request approval and question flows, read-only file selections as context, and a current-turn change viewer.
- Preserve operation receipts across browser disconnections and service restarts; uncertain execution blocks a second send until a terminal result is confirmed.
- Add bounded history pagination, event replay, request deadlines, and a clearly labeled simulation runtime for isolated acceptance.
- Add workspace-token sign-in, same-origin mutation checks, and loopback binding by default.

### Changed

- Set the default workspace port to 6670. Set `CODES_PORT` to use a different listener port.
- Improve the sign-in layout for desktop and mobile, with clearer token input, visibility controls, token-location help, and retry after a failed initial connection check.

### Fixed

- Preserve the loaded history when reselecting the current conversation, and prevent older list responses from replacing a new task title or a live rename. Seed sidebar metadata from the selected snapshot so a subscription handoff cannot leave a working conversation labeled Untitled.

- Open conversations with dense tool history by reducing the number of turns per history page when the combined page exceeds display limits. Older-page cursors remain aligned with the returned records; a single oversized turn still reports an explicit limit.
