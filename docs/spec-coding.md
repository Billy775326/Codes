# Spec Coding

Use this specification for changes to Codes execution, configuration, and recovery. The [architecture](architecture.md) maps the implementation.

## Codex owns execution configuration

The effective configuration resolved by the installed Codex CLI for the verified execution directory is the **single source of truth** for model, reasoning, speed tier, sandbox, permission profile, approval policy and reviewer, agent network access, and native feature flags.

Codes owns browser preferences, workspace navigation, HTTP access, queue ordering, local receipts, and their presentation. These application settings coordinate delivery while Codex determines how the native turn executes.

### Read and write configuration

- Ask App Server for the effective project configuration. Preserve native layering, trust, and managed requirements. Expose the relevant value and its source.
- Use the native write interface and revision check for execution changes. Read the effective configuration again after saving. Show unavailable fields or operations explicitly.
- Treat legacy settings stored in Codes as migration input. Keep cached native configuration disposable and verify the applicable configuration before dispatch.
- Compare configuration independently of object key order. Preserve value changes, array order, source revisions, and runtime identity.

### Dispatch and report execution

- Apply the same ownership and configuration rules to creation, resume, send, native review, branch, and queued dispatch. An immediate follow-up inherits the active turn.
- Use native signals for current status and usage. Show effective values for future work, and use unknown when runtime evidence is missing.
- Keep queue acceptance, execution completion, and browser receipt delivery separate. Correlate native completion by operation or turn identity before releasing uncertain work.
- Verify the conversation directory before using stored file context or starting work. Preserve the original project association through navigation and recovery.

### Migration and acceptance

Preserve operation receipts, queued payloads, and historical execution records. Hold legacy queue entries for review when the effective configuration or permissions cannot be verified.

For changes to this contract, test a trusted project override, stale user-layer write, effective configuration at dispatch, active-turn inheritance for steering, and verified legacy queue recovery. Distinguish simulator behavior, native metadata compatibility, and real task acceptance. [Configuration and migration](conversation-settings.md) · [Verification](acceptance.md)

- [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-basic)
- [App Server configuration interfaces](https://learn.chatgpt.com/docs/app-server)

## Session discovery and working directories

- Codex owns the session list, native thread IDs, archive state, and conversation working directories. The web sidebar must support the same working-directory and archive filters as the CLI.
- New drafts use the Codex App Server's startup directory by default and acquire a native thread ID on first send. A directory chosen for a draft becomes the explicit `cwd` passed to Codex. Use the returned native `cwd` to verify working-directory ownership. Existing conversation history, files, and execution use the directory reported by Codex for that thread.
- Codes keeps local metadata only for web delivery, files, preferences, and compatibility with existing receipts and queues. Derive workspace keys from native cwd without requiring project registration. An unresolved directory change must not replay queued paths in a new directory.

## Connection and account status

- Check browser reachability with the authenticated workspace cursor and the event stream handshake. Keep one stream per visible tab, scoped to the selected conversation plus workspace metadata. Load the selected history separately and replay buffered events newer than its snapshot cursor. A history error only affects that conversation.
- Check the Codex App Server handshake independently of browser authentication. Read account status with `account/read` and `refreshToken: false`. Refresh after native account changes, on focus when stale, on manual request, and before starting new execution when stale. Show unknown when the installed CLI or effective provider cannot confirm the state.
- Block new execution only for a confirmed missing or stale account for the built-in OpenAI provider. Preserve drafts, receipts, and queue positions. Account checks never dispatch a task, resume a held queue, or restart a running App Server. If terminal login and App Server state differ, show the restart action for after active work finishes.

- Offer in-browser sign-in when the installed App Server supports native device login and the OpenAI account is confirmed signed out. Let Codex manage the login session and credentials. Expose an active one-time code only to the authenticated workspace, correlate native completion and cancellation, and recheck account readiness after completion.

## Launcher lifecycle

Keep foreground launch available. Background start waits for the initial listener and writes private logs. Lifecycle commands select the same data directory as startup and verify the current lock owner and database before stopping a process. Restart captures the original startup environment before shutdown and keeps it in memory. The launcher uses the server's graceful shutdown and lets the server release its own lock.
