# Small-scale acceptance

Target: one owner, one Linux host, a desktop browser for development, and a phone for progress and approval. Begin with a temporary project and the simulation runtime; move to real Codex only after transport and UI checks pass.

## Acceptance gates

| Gate                 | Required behavior                                                                                                  | Check                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Dispatch             | Duplicate operation IDs do not create a second user message or task                                                | Service test and lost-browser-receipt browser test |
| Recovery             | A lost native acknowledgement remains unknown; only matching terminal history releases the lease                   | Service fault-injection test                       |
| Browser independence | Closing the originating page leaves approval available to a different signed-in device                             | Desktop-to-mobile browser test                     |
| Stop                 | Stop propagates to the runtime and remains interrupted after reload                                                | Service and browser tests                          |
| Context              | File selection is sent with a checksum; changed files, hidden paths, traversal, and escaping symlinks are rejected | Service and browser tests                          |
| Long history         | Open the latest 12 turns, load another page, type, then switch conversations                                       | Browser test against 100 synthetic turns           |
| Authentication       | APIs require a session; foreign origins and hosts are rejected; logout revokes the cookie                          | HTTP tests                                         |
| CLI compatibility    | Initialize and read model/thread metadata with an empty temporary CLI home                                         | `npm run test:native`                              |
| Live execution       | A real model turn streams, can be stopped, and preserves native history                                            | Passed basic isolated read/write/interrupt pilot   |
| Live approvals       | Real CLI command/file/permission approvals and questions resolve correctly under the owner's policy                | Pending isolated live acceptance                   |
| Deployment           | The intended service user, HTTPS proxy, phone, restart, backup, and restore work together                          | Pending deployment acceptance                      |

## Local evidence

Automated checks use Node 24.22.3 on Linux. Browser checks use Chrome 148.0.7778.215 with Playwright 1.64.0 at 1440×1000, 820×900, 390×844, and 320×640. The default tests create temporary data and use no account credentials, real model prompts, or project commands. The separately invoked live pilot uses the server login and model quota.

Login coverage checks responsive layout, token visibility, rejected credentials, pending controls, keyboard submission, and recovery from an initial connection failure. The browser suite also covers streaming and reload; a closed desktop followed by phone approval; offline recovery with a retained draft; an accepted request whose HTTP response is lost; interruption; and bounded long history. Its history case rejects an observed long task of 250 ms or more during page loading and typing. This is a local acceptance threshold, not a production performance guarantee or a benchmark against another application.

The native smoke uses CLI 0.167.0 and an empty temporary `CODEX_HOME`. It checks initialization, model metadata, a new read-only thread, metadata read, and empty-history behavior. It deliberately sends no model request. A successful smoke must not be presented as complete live execution acceptance.

Run the commands from the [README](../README.md#checks) for current pass/fail output. CI runs formatting, types, unit/integration tests, and simulator browser checks. It does not have the owner's CLI login and does not run live acceptance.

## Conversation management acceptance

On 2026-11-17, the existing baseline passed 37 unit/integration tests, 13 simulator browser tests, a metadata-only native smoke, and the isolated live read/write/interrupt pilot before this implementation.

The conversation-management implementation passes 45 unit/integration tests and 18 simulator browser tests, plus formatting, types, and a production build. Added coverage includes 250 native-shaped conversations across cursor pages, case-insensitive title search, filter-scoped cursors, rename during a pending approval without losing its execution receipt, archive/restore with retained history, duplicate mutation IDs, blocked active/unknown executions, lost archive acknowledgements, and schema 1 backup/migration with private permissions. Browser checks cover per-conversation drafts, selected/archived reload, two-client metadata updates with an intentionally interrupted event handoff, narrow-screen actions/dialogs, and delayed list responses arriving after a live rename or the first task title. Desktop and 320-pixel modal screenshots were inspected using synthetic data.

The real CLI 0.167.0 live pilot also passed native rename, active/archived discovery, history preservation, send rejection while archived, and a new model turn after restoration. It used only the disposable fixture and the server login. The metadata-only smoke separately passed with an empty temporary Codex home and no model requests. These results do not complete HTTPS/physical-phone, real prompting-policy, or deployment backup/restore acceptance.

## Live pilot evidence

A live pilot with CLI 0.167.0 and the server's existing login passed these checks in a temporary directory:

- Read a known README fixture and receive streamed commentary, command activity, and the final answer.
- Read the native paginated history and preserve the operation's client message UUID.
- Explicitly switch to Workspace write, modify only the fixture README, and receive native file-change/diff events.
- Interrupt a newly acknowledged turn and release its execution lease only after the interrupted terminal event.

The first interrupt attempt exposed a startup race: the CLI can acknowledge a turn before its runner accepts interruption. The adapter now retries cancellation of that same turn within a fixed limit; it never retries task dispatch. The live pilot passed after the fix. The reusable command is `npm run test:live -- --allow-model-requests`.

A separate harmless `printf` approval probe completed with **zero approval callbacks** under the current host policy. It therefore did not validate the real approval UI. File/permission approvals, structured questions, and a policy that actually prompts still need manual live acceptance. Simulator browser approval tests must not be represented as those live checks.

## Live pilot checklist

Use a disposable Git repository with a harmless text fixture and the intended service account. Keep real user data out of the fixture.

1. Start in Read only. Ask Codex to explain the fixture and verify response/history consistency after refresh.
2. Start a long but harmless task, reconnect the browser, then stop it. Verify the native terminal result and that no duplicate turn appears.
3. Choose Workspace write explicitly. Request a small edit; inspect the patch and actual file after completion.
4. Exercise a real approval under the intended CLI policy. Close the desktop, answer from a phone, and ensure only one response is accepted.
5. Check a structured question and a permission request, including decline and expired-request behavior.
6. Restart the service during a task. Confirm that the UI reports an unknown outcome, does not resend automatically, and only clears the lease when matching native history proves completion.
7. Test the chosen HTTPS proxy, logout, token replacement followed by restart, and a backed-up data-directory restore.

Failures block promotion to a released version. Record the exact CLI version, policy, browser, fixture, outcome, and unresolved limits. Formal release or deployment requires the owner's approval.
