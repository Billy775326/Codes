# Spec Coding

## Codex owns execution configuration

The effective configuration resolved by the installed Codex CLI for the actual execution directory is the **single source of truth** for agent execution in Codes. This covers the model, reasoning effort, speed tier, permission profile, sandbox, approval policy and reviewer, agent network access, and native feature flags.

See [Conversation settings](conversation-settings.md) for the configuration editor and migration behavior.

### Read and write configuration

- Read effective settings through the Codex App Server for the conversation's verified project directory. Let Codex apply its configuration layers, project trust, and managed requirements. Project only the fields and source information needed by the interface.
- Persist execution changes through supported native configuration interfaces. Show the target scope before saving, use the native version check where available, and read the effective value after the write. If a higher-priority layer determines the value, show that source. Represent unsupported operations and unavailable values explicitly.
- Treat copies of execution settings in Codes preferences, drafts, SQLite, and queue payloads as historical or migration data once the native path is active. Any cache of native configuration is disposable and must be refreshed after a write and verified before execution.
- Compare native configuration independently of object field order. Preserve value changes, array order, source versions, and runtime identity when detecting changes before execution.

### Dispatch and report execution

- Use the same configuration rules for new and resumed conversations, sends, branches, reviews, and queued turns. Use native operations for explicit actions such as Plan and review. An immediate follow-up joins the existing native turn and inherits its running configuration.
- Show the effective project configuration when describing future work. Show the runtime values Codex reports when describing an active or completed turn. Report unavailable runtime fields as unknown.
- Codes owns browser preferences, Web access and listener settings, project navigation, queue ordering, and operation receipts. Those settings govern the Codes interface and service.

### Migration and acceptance

Preserve operation receipts, queue contents, and historical execution records. Treat legacy execution settings as input to migration review. Require explicit review before applying them to a Codex configuration layer or dispatching a legacy queue entry under broader permissions.

Verify the following on the supported CLI versions before enabling the rewritten path:

- A trusted project setting takes precedence over the user layer, and a stale write reports a conflict.
- New, resumed, branched, reviewed, and queued work use the effective native settings. An immediate follow-up retains the active turn's settings.
- Restoring a legacy queue preserves its messages and receipts and holds entries that need permission review.
- The interface distinguishes the effective configuration for future work from the native settings reported for an existing turn.

See [Codex configuration layering](https://learn.chatgpt.com/docs/config-file/config-basic) and the [App Server configuration interfaces](https://learn.chatgpt.com/docs/app-server#config-rpc-examples-for-app-settings).
