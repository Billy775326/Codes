# Local IDE interaction alignment

codes targets the Codex IDE extension's local conversation workflow in a Linux browser. VS Code host integration and Codex Cloud are explicitly excluded. This is a functional alignment audit, not a claim of pixel-identical UI or complete extension parity.

## Evidence baseline

The reference extension is the stable Linux x64 Marketplace package `openai.chatgpt` **26.1111.21308**, inspected on **2026-11-18**. Its public [extension manifest](https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.1111.21308/1794532470202/Microsoft.VisualStudio.Code.Manifest) declares the queue/steer preference, Enter behavior, review delivery, commands for adding selections/files, and the new-chat shortcut. The manifest SHA-256 is `0ae058c9b1d155e362805d4310dabc65c2fc86bbb6151b003177b1cfaaa20108`.

The extension's complete frontend source was not available in the inspected public repository. We inspected its published manifest, fetched official functional documentation, and read the open-source app-server implementation. No extension bundle was installed, executed, copied, or treated as open-source UI code.

Behavior references:

- [IDE settings](https://learn.chatgpt.com/docs/ide/settings): `chatgpt.followUpQueueMode` (`queue`, `steer`, legacy `interrupt`), `chatgpt.composerEnterBehavior` (`enter`, `cmdIfMultiline`, `cmdAlways`), and `chatgpt.reviewDelivery` (`inline`, `detached`).
- [IDE commands](https://learn.chatgpt.com/docs/ide/commands) and [developer commands](https://learn.chatgpt.com/docs/developer-commands): local command actions and editor context.
- [Code review](https://learn.chatgpt.com/docs/code-review): native review targets and conversation delivery.
- [App-server protocol](https://learn.chatgpt.com/docs/app-server): task input, steering, collaboration modes, reviews, and notifications.
- Pinned CLI **0.167.0** sources: [turn processor](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server/src/request_processors/turn_processor.rs) and [thread processor](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server/src/request_processors/thread_processor.rs). The CLI's generated JSON schemas, including experimental fields, were checked against this installed version.

Current official docs can describe a newer protocol. The installed version's schema and source determine what this adapter actually sends.

## Implemented local contracts

| Interaction            | codes behavior                                                                                                                                | Acceptance                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Ordinary conversations | Native discovery, title search, pagination, rename, archive/restore, drafts and reconnect                                                     | Existing conversation and browser regression suites                        |
| Follow-ups             | Queue is the default. Steer calls `turn/steer` with `expectedTurnId` and a unique client message ID; it continues the same native turn        | Same-turn history, duplicate ID, stale turn and lost acknowledgement tests |
| One-shot inversion     | Ctrl/Cmd+Shift+Enter swaps queue and steer for one active follow-up without changing the saved preference                                     | Browser tests for both directions                                          |
| Queue Send now         | Atomically claims a waiting message and steers the running turn. Different task settings keep the message queued                              | Queue promotion race, settings mismatch and browser tests                  |
| Enter behavior         | Enter, modifier for multiline drafts, or modifier always; Shift+Enter inserts a line; IME composition does not submit                         | Browser preference tests; existing composer behavior                       |
| Mobile typing          | Plain Enter inserts a line; explicit action buttons send, queue, steer and stop                                                               | 390px browser checks                                                       |
| Model and reasoning    | Model catalog supplies the allowed reasoning efforts. Unadvertised effort is rejected before dispatch; custom model identifiers are preserved | Server metadata validation and native metadata smoke                       |
| Plan and Code          | Native `collaborationMode` with built-in instructions, using `developer_instructions: null`; Code explicitly exits Plan                       | Native metadata/settings smoke and simulator turn tests                    |
| Task plan              | Display native `turn/plan/updated` steps and statuses; do not generate a synthetic plan from assistant prose                                  | Notification and browser tests                                             |
| Native review          | Uncommitted changes, base branch, commit SHA or custom instructions; `review/start`; read-only sandbox and visible review items               | Protocol, history and browser review tests                                 |
| Separate review        | Create a separate conversation in the same project, then use native inline review there. The pinned CLI accepts only `delivery: inline`       | Browser source-preservation and detached-conversation checks               |
| Context                | Read-only file browsing; attach a selection or the entire file with a SHA check and combined 100 KB input budget                              | Existing changed-file tests; shared input validation                       |
| Status                 | Connection, runtime/version, model, reasoning, permissions, turn, latest context tokens/window and cumulative tokens                          | Native metadata and notification/browser checks                            |
| Commands               | `/model`, `/reasoning`, `/plan`, `/review`, `/status`, `/approve`, `/fork`, `/ide-context` invoke explicit Web actions                        | Browser tests; unknown commands never become model prompts                 |
| New conversation       | Ctrl/Cmd+N inside the page and the existing button preserve prior drafts                                                                      | Browser tests; OS/browser-reserved shortcuts may still take precedence     |

Steering uses the running task's model, mode and permissions. It does not interrupt and restart the task. Waiting approvals/questions must be answered or canceled; immediate steering is unavailable in those states and during native reviews. Queue remains available. Legacy stored `interrupt` preferences are normalized to `steer`.

Review starts in Read only, including when the composer previously selected Workspace write. A separate review shares current project files, without a Git worktree, file rollback, or copied source conversation history. These are explicit product choices at the Web adapter boundary.

## Recovery and compatibility

Normal sends and native reviews share one durable execution lease per conversation. Steering has separate durable receipts and never replaces that lease. Pending follow-up broadcasts contain at most 2,000 characters per entry; full native input remains intact. Unknown steer acceptance blocks another task, queue dispatch and archiving until native history confirms the result. The server never automatically resends an uncertain send, steer or review.

Inline review emits an inner runner start and an outer review completion in CLI 0.167.0. The adapter matches the outer completion to the exact acknowledged review ID, including when the event precedes its HTTP/RPC response. It keeps a bounded cache of terminal identities for that ordering race.

A review cannot attach a client message ID with this CLI. A returned native turn ID can be reconciled with history. When both acknowledgement and turn identity are missing, the conversation stays protected. A recent unrelated terminal event is insufficient evidence. Reconciliation still has the existing bounded recent-history scan.

Metadata schema **4** expands the execution lease to include reviews. Schemas 1–3 are backed up to a private `codes.schema-v<version>-<timestamp>-<uuid>.sqlite` before migration. Existing projects, settings, native conversation references and receipts are retained. Old settings and queue payloads without mode/effort fields remain readable. The older application cannot read schema 4; restoring a backup requires a coordinated metadata/native-history recovery, not an in-place downgrade.

The app-server connection opts into experimental API fields because native collaboration modes require them. This remains tied to CLI 0.167.0. No arbitrary RPC or configuration-writing endpoint is exposed to the browser.

## Remaining local differences

These items remain unimplemented; they are not implied by the controls above:

- Image paste/upload, image history, and rich context chips.
- Native context compaction and detailed model reasoning traces/tool categories.
- Skills, MCP/plugin configuration and elicitation, memories, goals, fast/service-tier controls, and their related commands.
- Multi-panel concurrent conversation layout and a complete command palette.
- Broader recovery lookup and scalable history/file virtualization, tracked in [requirements](requirements.md).

The current command list is deliberately restricted to real implemented actions. Unsupported IDE/CLI commands report an error instead of silently being forwarded as a normal prompt. `/ide-context` opens the Web file picker; it cannot read VS Code buffers or selections.

VS Code document/selection synchronization, CodeLens, terminal/LSP integration, VS Code settings synchronization, Windows/WSL integration, Codex Cloud tasks, cloud environments and cloud delegation are excluded by scope. Their absence is not a defect in this local workflow acceptance.

## Verification boundaries

Simulator tests establish Web behavior and adapter recovery. The empty-home native smoke checks real model/effort metadata, Plan/Code presets, `thread/settings/update`, thread creation and history without model requests. Neither establishes real model planning quality, review findings quality, prompting-policy variants, physical-phone behavior or deployment acceptance. Record any opt-in live results separately in [acceptance](acceptance.md).
