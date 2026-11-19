# Task write boundary

A single-owner Linux installation can limit native task writes to one existing directory. This is separate from per-conversation preferences: choosing a model or permissions cannot expand an owner boundary. It does not move the server account, `CODEX_HOME`, login, history, or application runtime data.

## Configure this installation

From the intended project directory, start with an explicit absolute root:

```bash
CODES_TASK_WRITE_ROOT="$PWD" codes
```

To persist the policy across ordinary `codes` restarts, create `task-policy.json` in `CODES_DATA_DIR` (the installed launcher defaults to this checkout's `.local`). Replace the example with the actual absolute directory:

```json
{
  "version": 1,
  "writeRoot": "/absolute/path/to/codes"
}
```

Keep this private owner configuration out of Git. The directory must already exist. A persisted policy and an environment root must resolve to the same directory; conflicting settings, unsupported versions and malformed files stop startup. Configuration is read once at startup, not on task or browser requests. Changing it requires an owner-controlled restart. Back up the file before changing it. Wait for running tasks and dispatchable queues before restarting; stopping the service interrupts its native process.

The policy belongs to that data directory. Tests and other installations with a different data directory do not inherit it. Existing conversation settings are preserved; saved Full access preferences must be changed to Read only or Workspace only before a future task can run. Already queued Full access entries fail closed when dispatched, rather than silently receiving different permissions. Completed receipts remain readable.

## Enforcement and behavior

- Canonicalize the allowed root and project paths. Reject projects outside the root, including sibling-prefix and symlink escapes. Projects inside the root can share the same allowed write boundary.
- Launch the native App Server with its working directory inside the allowed root. This matters because Codex includes its own working directory when resolving writable workspaces.
- Apply explicit sandbox policies to new/resumed/forked conversations, turns, reviews and command execution. Read only remains read only. Workspace only grants the fixed root, excludes `/tmp` and inherited `TMPDIR` as additional writable locations, and keeps native protected configuration/repository paths read only.
- Disallow Full access and native sandbox elevation. Decline command/file/extra-permission approval requests under this policy; native questions still work. There is no browser approval that can unlock external writes. An externally active native conversation must finish before it can be resumed with the boundary.
- Disable native Apps for this child process, and refuse configured enabled MCP servers, plugins and executable hooks. Those processes are not confined by the command/file sandbox, so silently allowing them would make the boundary misleading. Disabled entries are permitted. Project configuration is checked before starting/resuming/forking a conversation.

Workspace-only commands retain network isolation and cannot elevate for dependency downloads or protected Git metadata writes. If a task needs temporary output or tool caches, place them beneath the allowed root and explicitly configure that command, for example `TMPDIR="$PWD/.local/task-tmp"` after creating the directory. Do not add another writable root as a workaround. Built-in browser/search features and read access are separate from the filesystem write boundary.

This is a task execution policy for the supported CLI, not isolation from the server owner or a substitute for a dedicated Unix account/container for hostile code. The owner controls the service, its source, environment and private configuration; review those before restarting a modified build. The App Server itself still writes native account/history/cache state as before. Codes runtime storage, uploads, logs and database files continue to use their existing configured locations.

## Verification

`npm test` covers canonical path checks, rejected preferences and task submissions, queue admission and invalid/conflicting configuration. Browser tests cover the permission choices and settings modal. `npm run test:sandbox` requires the pinned CLI 0.167.0 and runs disposable native shell commands with an empty Codex home; it sends no model prompts. It checks an inside write, outside write, symlink escape, protected `.codex` file, and `/tmp` denial. It does not establish model quality or a full live task acceptance.

References: [official sandbox behavior](https://learn.chatgpt.com/docs/sandboxing), [temporary-directory sandbox configuration](https://learn.chatgpt.com/docs/config-file/config-reference), and the locally generated CLI 0.167.0 `SandboxPolicy`, `ThreadStartParams`, `ThreadResumeParams` and `CommandExecParams` types. Newer documentation alone is not evidence that this pinned adapter supports a field.
