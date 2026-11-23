# Small-scale acceptance

Target: one owner, one Linux host, a desktop browser for development, and a phone for progress and approval. Begin with a temporary project and the simulation runtime; move to real Codex only after transport and UI checks pass.

## Acceptance gates

| Gate                 | Required behavior                                                                                                  | Check                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Dispatch             | Duplicate operation IDs do not create a second user message or task                                                | Service test and lost-browser-receipt browser test |
| Recovery             | A lost native acknowledgement remains unknown; only matching terminal history releases the lease                   | Service fault-injection test                       |
| Browser independence | Closing the originating page leaves approval available to a different signed-in device                             | Desktop-to-mobile browser test                     |
| Stop                 | Stop propagates to the runtime and remains interrupted after reload                                                | Service and browser tests                          |
| Context              | Send file context with a checksum, opt into hidden paths, and reject stale files, traversal, and escaping symlinks | Service and browser tests                          |
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

## In-conversation workflow acceptance

On 2026-11-18, the workflow checks pass 60 unit/integration tests and 22 simulator browser tests, including the previous regressions. New cases exercise FIFO dispatch, pause/edit/remove, uncertain outcomes, stop/decline behavior, changed queued context, queue capacity and bounded cross-conversation scheduling, bounded broadcasts with full stored messages, schema 1/2 migration, restart holds, native per-turn branching, source archive-state discovery, structured choices/custom/secret answers across clients, quoted drafts, lost queue HTTP receipts, and delayed control responses arriving after newer queue events. Mobile checks include fully visible Queue/Stop controls; synthetic mobile question and desktop queue screenshots were inspected.

The opt-in live pilot with CLI 0.167.0 also passed a native branch through the first completed turn, preservation of later source history and current files, and two sequential queued model turns in that branch. The existing read/write, archive/restore, and interrupt pilot checks passed in the same disposable fixture. The real prompting-policy and deployment gates remain open. These results do not claim queue reordering, in-flight steering, file isolation, or an expanded reconciliation search window.

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

## Local IDE interaction acceptance

On 2026-11-18, the isolated CLI 0.167.0 IDE pilot passed real Plan mode with catalog reasoning effort, a transition back to Code, a follow-up appended to the same turn, preserved client identity in native history, native token usage, and a Read only custom code review with review items and a durable terminal receipt. It used the server login/model quota and exposed only a disposable README fixture. No project edits or approval grants were requested. Run it explicitly with `npm run test:live:ide -- --allow-model-requests`.

The first real review attempt exposed a mismatch absent from the initial simulator: native inline review starts an inner runner but completes using the acknowledged outer review ID. Ignoring that completion left the task working and led the pilot's cancellation to time out. The adapter now correlates the exact outer ID and caches bounded terminal evidence for responses arriving after events. The simulator reproduces this ordering, and a delayed-ack regression checks it. The full live IDE pilot passed after the correction; no uncertain model request was automatically retried.

The separate empty-home native smoke now also checks model reasoning metadata, Plan/Code presets and thread settings updates, without model requests. The final local suite passes 76 unit/integration tests and 34 simulator browser tests, plus formatting, type checks and a production build. Simulator/browser evidence covers queue/steer inversion, queue promotion, stale turns, unknown receipts, review targets/delivery, preferences, commands and mobile controls. Native review findings quality, real approval/question policy variants, HTTPS/physical phones and deployment/restore gates remain separate. The [alignment audit](ide-parity.md) records the extension version, inspected sources, supported contracts and remaining local differences.

A CI browser regression exposed a delayed HTTP acknowledgement clearing a newer composer draft. The composer now checks the captured edit revision before clearing text/context and carries edits across first-conversation creation. Deterministic browser cases hold each create/send/queue/steer response while typing the next draft.

## Clarification and patch-preview details

The detail implementation passes 86 unit/integration tests and 41 simulator browser tests. The added cases cover optional Code questions versus required Plan questions, explicit skip without another turn, suggested choices without automatic submission, radio-key navigation, custom text equal to an option, next-draft preservation, stale callbacks, resumed working status, structured file history, repeated edits under a shared preview budget, and stale-turn diff rejection. Existing cross-client/secret-question and all previous browser regressions also pass.

Patch coverage includes multiple files, added/deleted/renamed files, quoted and octal UTF-8 paths, hunk line numbers, malformed/oversized path boundaries, character/row/file budgets, literal HTML content, unified and side-by-side views, read-only file navigation, previous loaded turns after reload, 200-row windows and incomplete-preview notices. Synthetic desktop/390px question and diff screenshots were inspected. No production conversation content or credentials appear in those artifacts.

The empty-home native smoke additionally verifies `features.default_mode_request_user_input=true` in the actual CLI configuration after starting the process. A separate metadata-only check verified the explicit false opt-out. Both used CLI 0.167.0, no model prompts and no global configuration edits. These checks establish protocol/configuration compatibility; they do not claim a live model asked or answered a new question under the owner's host policy. The real prompting/approval, physical-phone and deployment gates remain open.

## IDE panel layout acceptance

On 2026-11-18, the panel implementation passed 86 unit/integration tests and all 48 simulator browser tests, plus formatting, types and a production build. Seven added browser cases cover default collapsed history and draft retention, keyboard/pointer model-menu dismissal, `/model` focus, file-card review navigation, left-diff/right-chat geometry, clipboard copying, persisted dark/light/system themes and 1440/820/390/320px widths. Each width also checks that clicking Stop actually issues the interrupt request and retains the next draft. Existing question, approval, queue/steer, branch, reconnection, uncertain-receipt and history regressions remain included.

Visual inspection compared synthetic desktop review and dark/light/mobile screenshots with the official IDE review image listed in the [alignment audit](ide-parity.md#panel-layout-reference). The layout remains an independent browser implementation, with read-only previews and the documented remaining feature differences. This round uses no new real model prompts, credentials in artifacts, physical-phone acceptance or formal release.

## Web workspace navigation acceptance

On 2026-11-18, the Web workspace change passed 86 unit/integration tests and all 52 simulator browser tests, including the earlier IDE interaction regressions. Four added cases verify per-project new drafts with cleared attachments/previews, one-time legacy draft reading, cancellation of a held file response during project switching, and mobile drawer focus/attachment return while a task continues running. Layout checks now require persistent default desktop navigation, central chat and right-side review, with responsive drawers on narrower screens. Closing navigation and creating a conversation return keyboard focus to usable controls.

Synthetic desktop/light/mobile screenshots were inspected for the Web layout. The browser shell changes neither metadata schema 4 nor the native CLI protocol. This round sends no new real model prompts and does not replace the separately tracked live approval/policy, physical-phone, HTTPS and full backup/restore acceptance.

## Native Auto-review and context-compaction acceptance

The CLI 0.167.0 empty-home smoke verifies all four permission presets, including native Auto-review and explicit restoration of the human reviewer. Native settings notifications confirm reviewer changes; global reviewer/speed configuration remains unchanged. This check creates only temporary metadata and sends no model prompts.

Service regressions cover reviewer parameters on creation/dispatch, captured queue settings, independent defaults, managed-policy refusal before dispatch, persisted Auto-review profiles, bounded native review notices, compaction start/completion, duplicate/replayed items, stale turns, terminal failures, interruption, and runtime loss. Browser cases cover per-conversation/default selection, disabled managed choices, desktop/390px reload during compaction, retained queue entries after compaction completion, and Stop. These are simulator/API lifecycle checks, not real reviewer-decision quality or long-context model acceptance.

The owner-provided V3 icon and both wordmarks match the original SVG bytes. English and Chinese identity documentation now describe the active assets; application-source licensing remains undecided. The [navigation design](session-navigation-proposal.md) retains the earlier baseline findings and now records the adopted project + conversation architecture; its implementation evidence is recorded below.

Local browser coverage on 2026-11-19 included all 139 scenarios across sequential batches and focused reruns, with no skipped scenarios counted as passed. A host reboot interrupted one batch; the 34 completed scenarios from its first four files were retained and uncompleted files were rerun. Two launcher cases passed with a canonical temporary path after a symlink-path assertion mismatch. The permission-count expectation was updated for the fourth preset. One image-preview scenario timed out once, then passed three focused reruns without changing its assertion or image implementation; this remains a local flaky observation rather than proof of a fixed image defect.

Unit/integration evidence covers 177 distinct scenarios: a full 176-case run and an 80-case follow-up on affected modules, including an added inner/outer-review compaction case. The follow-up includes inner/outer-review compaction cleanup and the existing branch regressions. Format/type checks, the production build, and the no-model native smoke are separate gates.

## Project and conversation context acceptance

On 2026-11-19, local verification passed all 185 unit/integration tests, all 145 simulator browser scenarios in one complete run, formatting, type checks, and a production build. After the last queue-dispatch and cached-history adjustments, the full 185-case unit suite and eight focused browser cases passed. Those browser cases include project ownership at 1440/390px, independent project views/drafts/settings, running-task and queue preservation, poisoned recent-view rejection, missing-directory recovery, disabled queued steering while unavailable, single/empty project navigation, steering receipts, and branching.

Service regressions verify same-named files in two projects, native directory disagreement, explicit task working directories, root symlink retargeting, distinct directory/file errors, queue pausing before claim, and startup with a missing registered directory. Cached history and existing receipts remain available when native execution is offline; file/execution endpoints still validate native ownership before admission. Browser navigation metadata remains bounded to 20 projects. The metadata schema stays at 4 and no new task write-root restriction is introduced.

The CLI 0.167.0 smoke separately passed explicit thread working-directory settings, missing-directory context and history reads, rejection of new creation while missing, and restoration, alongside existing model/mode/permission metadata checks. It used an empty temporary Codex home and sent no model requests. This round does not establish real model behavior under a moved directory, physical-phone/HTTPS acceptance, complete filesystem race isolation, or production deployment. Updating the owner's existing 6670 preview and its read-only native browser checks are separate delivery verification.

## Imported legacy history acceptance

On 2026-11-19, all 189 unit/integration cases and all 145 simulator browser cases passed after adding legacy full-item turn paging. Formatting, type checks, the production build and the empty-home native metadata smoke also passed. Regressions cover reverse anchors and forward catch-up, avoiding eager full-thread reads and unsupported item pagination, malformed full items, empty native histories, and unchanged display budgets. Paginated-history behavior remains covered by the existing suite.

A separate read-only native check against CLI 0.167.0 used an isolated Codes metadata database and existing histories: an active legacy conversation with an older page, an archived legacy conversation with messages, a genuinely empty archived legacy conversation, and an archived paginated conversation. It read no full thread, dispatched no task, and changed no original conversation or permission configuration. This evidence validates those selected native histories, not every historical item or large single turn. Private user inventory and backups remain outside Git.
