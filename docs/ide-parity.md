# Local IDE interaction alignment

codes targets the Codex IDE extension's local conversation workflow in a Linux browser. VS Code host integration and Codex Cloud are explicitly excluded. The local interaction workflow follows the published IDE reference within a browser workspace layout. This independent Web implementation does not claim pixel-identical UI or complete extension parity.

## Evidence baseline

The reference extension is the stable Linux x64 Marketplace package `openai.chatgpt` **26.1111.21308**, inspected on **2026-11-18**. Its public [extension manifest](https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.1111.21308/1794532470202/Microsoft.VisualStudio.Code.Manifest) declares the queue/steer preference, Enter behavior, review delivery, commands for adding selections/files, and the new-chat shortcut. The manifest SHA-256 is `0ae058c9b1d155e362805d4310dabc65c2fc86bbb6151b003177b1cfaaa20108`.

The extension's complete frontend source was not available in the inspected public repository. The follow-up detail audit read the published [VSIX package](https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.1111.21308/1794532470202/Microsoft.VisualStudio.Services.VSIXPackage), including its minified extension host and Webview JavaScript. The package was not installed or executed, and no bundle code was reused in codes or treated as open-source UI code. Implementation also uses official functional documentation and the open-source pinned app-server.

The inspected host's nonblocking-request coordinator branches on `item/tool/requestUserInput.params.isBlocking`; the published UI also gates asynchronous Code questions separately from Plan. The shared Webview modules contain per-question drafts, choice/custom-answer controls, file entries, capped diff handling, and unified/split diff modes. These observations establish available mechanisms, not which remotely gated feature is enabled for every extension account.

Relevant package evidence (SHA-256):

The inspected extension host `out/extension.js` has SHA-256 `aa93a1b5aaa79746f3b583133355c659a0f059ff98d1956adf9da0e4afbcf817`.

| Published file                                                 | SHA-256                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `webview/assets/request-user-input-panel-de325f1727cf.js`      | `9be4707a7a3d1baf1f6d8d760b1b08157f614119130ecc2d418873118bdbca77` |
| `webview/assets/local-conversation-thread-b3241503ccfa.js`     | `17db24bf63760bbd4f244eb3cf50e221c8c1e99cc580f1db5ea6824b5216c2d4` |
| `webview/assets/thread-side-panel-tab-content-40cb0f8a4ff2.js` | `b2810642628723b25847c3188d7b7507206445a07d53fe74bb018d396252ab37` |

Behavior references:

- [IDE settings](https://learn.chatgpt.com/docs/ide/settings): `chatgpt.followUpQueueMode` (`queue`, `steer`, legacy `interrupt`), `chatgpt.composerEnterBehavior` (`enter`, `cmdIfMultiline`, `cmdAlways`), and `chatgpt.reviewDelivery` (`inline`, `detached`).
- [IDE commands](https://learn.chatgpt.com/docs/ide/commands) and [developer commands](https://learn.chatgpt.com/docs/developer-commands): local command actions and editor context.
- [Code review](https://learn.chatgpt.com/docs/code-review): native review targets and conversation delivery.
- [App-server protocol](https://learn.chatgpt.com/docs/app-server): task input, steering, collaboration modes, reviews, and notifications.
- Pinned CLI **0.167.0** sources: [turn processor](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server/src/request_processors/turn_processor.rs) and [thread processor](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server/src/request_processors/thread_processor.rs). The CLI's generated JSON schemas, including experimental fields, were checked against this installed version.
- Pinned [question handler](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/core/src/tools/handlers/request_user_input.rs) and [question schema/normalization](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/core/src/tools/handlers/request_user_input_spec.rs): root-thread availability, Plan blocking semantics, recommended choices and custom answers. The installed schema explicitly supplies `isBlocking` and answer arrays.

Current official docs can describe a newer protocol. The installed version's schema and source determine what this adapter actually sends.

## Web workspace layout

The official [IDE review screenshot](https://learn.chatgpt.com/images/codex/ide-review.webp), inspected on 2026-11-18, is a reference for chat controls and file cards. The browser shell uses a persistent project/conversation sidebar, central chat and right-side contextual previews. Opening a preview keeps navigation and chat in place. The [open-source documentation](https://learn.chatgpt.com/docs/open-source) distinguishes the open-source CLI from the proprietary IDE extension. No extension bundle or artwork is shipped with codes.

| Area                 | Responsibility                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Left navigation      | Show the single directory or switch projects, restore the project's last conversation, create/search/page conversations, rename/archive/restore, and inspect connection state |
| Central conversation | Read the selected history, answer native questions/approvals, edit drafts, select model/mode/permissions, send/queue/steer/stop                                               |
| Right preview        | Browse read-only project files or inspect selected-turn changes without replacing the conversation                                                                            |

Desktop navigation opens by default and remembers explicit collapse. Below 1100px navigation and context become focused drawers; file/change previews occupy at most 680px and use the full width on phones. Escape closes a drawer and returns focus to its opener. Mobile attachment actions return to the composer. Neither closing a drawer nor switching a conversation cancels a native task.

The server verifies conversation/project ownership and directory health before filesystem access or new execution. Snapshots repair stale browser project selections; missing directories retain history and expose Retry directory. Browser drafts for new conversations belong to the selected project, while existing per-conversation draft keys remain compatible. Switching projects/conversations closes previews and aborts pending file reads; late file responses cannot become context for another project. The data schema remains 4.

The composer uses one outer focus border and an unclipped model popup. Navigation owns the project picker, the header owns the conversation title, and starter drafts remain in the conversation action menu. Delivery scope is attached to the input and action controls as accessible descriptions and titles; active work retains its alternate action without a permanent instruction paragraph. It retains one rounded input area, attachment and Codex permission controls, a `/plan` toggle with a visible exit marker, a model/reasoning popup and explicit send/queue/stop actions. Edited-file cards and copy/reply/branch actions remain available. Dark/light/system themes are browser preferences. Read-only previews provide no Undo, staging or patch-application controls.

The permission menu displays the effective Codex settings for the selected project. Open **Settings → Execution** to edit native user settings. Codex resolves managed permission constraints and owns approval callbacks. Codes displays reviewer outcomes and bounded rationale when reported.

Browser acceptance covers pane geometry, menu/drawer focus, per-project drafts and legacy reads, delayed-file cancellation, attachment return, clipboard copying, saved themes and 1440/820/390/320px widths. Synthetic screenshots describe this Web implementation; they do not establish physical-phone acceptance or pixel equality with the extension.

The settings remain in a modal dialog with Appearance and Interaction groups, a scrollable content area and persistent close controls. Optional chat and message-code font sizes apply immediately and stay in this browser; Default preserves the existing responsive typography. Theme, follow-up, Enter and review preferences retain their existing values and behavior. The shared document palette also applies to sign-in and portaled confirmation dialogs. Editing/shortcut details are collapsed initially. A failed browser-storage write is shown explicitly; current-session changes still apply. Opening or closing settings keeps the current conversation subscription and draft.

The [interface design](interface-design.md) records component ownership, modal priority, and UX/DX/AX acceptance criteria.

## Implemented local contracts

| Interaction             | codes behavior                                                                                                                                                                                       | Acceptance                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Ordinary conversations  | Native discovery, title search, pagination, rename, archive/restore, drafts and reconnect                                                                                                            | Existing conversation and browser regression suites                            |
| Clarification questions | Native Code/Plan availability; required/optional semantics, explicit Skip, suggested choices without implicit submission, radio keyboard controls, custom/secret inputs and cross-client resolution  | Service and desktop/mobile browser regressions; real CLI config/metadata check |
| Patch inspection        | Per-file add/delete/move metadata, change counts, line numbers, unified/split layouts, current/earlier loaded turns, proposed approval patches, revision-specific viewed markers and 200-row windows | Patch parser/budget tests and desktop/mobile browser regressions               |
| Follow-ups              | The send shortcut adds to the current turn by default via `turn/steer`. Tab queues from the composer in this mode. The browser preference can make the send shortcut queue.                          | Keyboard delivery, same-turn history, and stale/lost receipt tests             |
| One-shot inversion      | Ctrl/Cmd+Shift+Enter swaps queue and steer for one active follow-up without changing the saved preference                                                                                            | Browser tests for both directions                                              |
| Queue Send now          | Atomically claims a waiting message and steers the running turn. Different task settings keep the message queued                                                                                     | Queue promotion race, settings mismatch and browser tests                      |
| Enter behavior          | Enter, modifier for multiline drafts, or modifier always; Shift+Enter inserts a line; IME composition does not submit                                                                                | Browser preference tests; existing composer behavior                           |
| Mobile typing           | Plain Enter inserts a line; explicit action buttons send, queue, steer and stop                                                                                                                      | 390px browser checks                                                           |
| Model and reasoning     | Model catalog supplies the allowed reasoning efforts. Unadvertised effort is rejected before dispatch; custom model identifiers are preserved                                                        | Server metadata validation and native metadata smoke                           |
| Plan and Code           | Native `collaborationMode` with built-in instructions, using `developer_instructions: null`; Code explicitly exits Plan                                                                              | Native metadata/settings smoke and simulator turn tests                        |
| Task plan               | Display native `turn/plan/updated` steps and statuses; do not generate a synthetic plan from assistant prose                                                                                         | Notification and browser tests                                                 |
| Native review           | Uncommitted changes, base branch, commit SHA or custom instructions; `review/start`; read-only sandbox and visible review items                                                                      | Protocol, history and browser review tests                                     |
| Separate review         | Create a separate conversation in the same project, then use native inline review there. The pinned CLI accepts only `delivery: inline`                                                              | Browser source-preservation and detached-conversation checks                   |
| Context                 | Read-only file browsing; attach a selection or the entire file with a SHA check and combined 100 KB input budget                                                                                     | Existing changed-file tests; shared input validation                           |
| Status                  | Connection, runtime/version, model, reasoning, permissions, turn, native context-compaction progress, latest context tokens/window and cumulative tokens                                             | Native metadata and notification/browser checks                                |
| Commands                | `/model`, `/reasoning`, `/plan`, `/review`, `/status`, `/approve`, `/fork`, `/ide-context` invoke explicit Web actions                                                                               | Browser tests; unknown commands never become model prompts                     |
| New conversation        | Ctrl/Cmd+N inside the page and the existing button preserve prior drafts                                                                                                                             | Browser tests; OS/browser-reserved shortcuts may still take precedence         |

Steering uses the running task's model, mode and permissions. It does not interrupt and restart the task. Waiting approvals/questions must be answered or canceled; immediate steering is unavailable in those states and during native reviews. Queue remains available. Legacy stored `interrupt` preferences are normalized to `steer`.

Code-mode question availability follows the installed Codex runtime and the effective native configuration. Explicit Skip supplies an empty native answer map only for an optional request.

Native review uses the effective Codex configuration. A separate review shares current project files and starts a new conversation in the same project.

## Recovery and compatibility

Normal sends and native reviews share one durable execution lease per conversation. Steering has separate durable receipts and never replaces that lease. Pending follow-up broadcasts contain at most 2,000 characters per entry; full native input remains intact. Unknown steer acceptance blocks another task, queue dispatch and archiving until native history confirms the result. The server never automatically resends an uncertain send, steer or review.

Inline review emits an inner runner start and an outer review completion in CLI 0.167.0. The adapter matches the outer completion to the exact acknowledged review ID, including when the event precedes its HTTP/RPC response. It keeps a bounded cache of terminal identities for that ordering race.

A review cannot attach a client message ID with this CLI. A returned native turn ID can be reconciled with history. When both acknowledgement and turn identity are missing, the conversation stays protected. A recent unrelated terminal event is insufficient evidence. Reconciliation still has the existing bounded recent-history scan.

Metadata schema **4** expands the execution lease to include reviews. Schemas 1–3 are backed up to a private `codes.schema-v<version>-<timestamp>-<uuid>.sqlite` before migration. Existing projects, settings, native conversation references and receipts are retained. Old settings and queue payloads without mode/effort fields remain readable. The older application cannot read schema 4; restoring a backup requires a coordinated metadata/native-history recovery, not an in-place downgrade.

The App Server connection opts into experimental protocol fields and detects supported operations from the installed CLI. The configuration editor permits specific execution settings through the native write interface.

## Remaining local differences

These items remain unimplemented; they are not implied by the controls above:

- General generated-image/file-image viewing, historical images unavailable in Codes storage, and richer context chips. Composer image paste/upload and stored-image history are implemented.
- Manual compaction commands and detailed model reasoning traces/tool categories. Automatic native compaction progress is displayed; it does not end the turn.
- Skills, MCP/plugin configuration and elicitation, memories, goals, and broader service-tier controls/commands. The native Fast/Standard toggle is implemented.
- Multi-panel concurrent conversation layout and a complete command palette.
- Full Git working-tree/base/commit diff scopes and stage/revert/partial-apply controls; persistent viewed markers and patch commenting. The implemented preview is limited to native changes in loaded turns and does not mutate files.
- Broader recovery lookup and scalable history/file virtualization, tracked in [requirements](requirements.md).

The current command list is deliberately restricted to real implemented actions. Unsupported IDE/CLI commands report an error instead of silently being forwarded as a normal prompt. `/ide-context` opens the Web file picker; it cannot read VS Code buffers or selections.

VS Code document/selection synchronization, CodeLens, terminal/LSP integration, VS Code settings synchronization, Windows/WSL integration, Codex Cloud tasks, cloud environments and cloud delegation are excluded by scope. Their absence is not a defect in this local workflow acceptance.

## Verification boundaries

Simulator tests establish Web behavior and adapter recovery. The empty-home native smoke checks real model/effort metadata, Plan/Code presets, `thread/settings/update`, thread creation and history without model requests. Neither establishes real model planning quality, review findings quality, prompting-policy variants, physical-phone behavior or deployment acceptance. Record any opt-in live results separately in [acceptance](acceptance.md).
