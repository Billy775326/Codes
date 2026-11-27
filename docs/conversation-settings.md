# Codex execution configuration

Open **Settings → Execution** for the selected project's effective model, reasoning, speed, permission, and native feature settings. The composer exposes the short list used for routine work. The **Task mode** choice controls Plan or Execution for the next task.

A write targets the Codex user configuration through App Server. The editor rereads the effective project values after saving, including overrides and their sources. For example, a trusted project setting can continue to determine the value after you save a user default. Reload after a concurrent change. Unsupported write operations leave the effective values available for inspection.

## Execution and recovery

| Task                                                 | Configuration used                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| New or resumed conversation, send, review, or branch | Codex's effective configuration for the verified project directory               |
| Waiting queue entry                                  | Effective configuration at dispatch, checked against the recorded configuration  |
| Add to current task                                  | The active Codex turn's configuration                                            |
| Session status                                       | Native runtime values for active work alongside effective values for future work |

Codex resolves permissions and managed constraints. In Code mode, native questions depend on the installed CLI and effective feature configuration. Codex reads these features when loading a thread. Start a new conversation to use a changed question setting immediately.

Use **Settings → Instructions** for global Codex instructions. See the [configuration reference](configuration.md#settings-by-function) for browser and Codes server settings.

## Usage and billing

The composer shows the latest context usage reported by Codex for the open conversation. Hover over or focus the context indicator to see the token counts. Its percentage divides the reported context tokens by the reported model window.

Open **Settings → Codex settings** for usage windows and their reset times, credit balance, and up to seven recently reported days of token activity. Clicking the context indicator or choosing **Usage and billing** in **Session status** opens this section directly. **Usage limit resets** shows the available count and any status, grant, and expiry details returned by Codex. Times use the browser's local time. The linked Codex dashboard handles billing and eligible resets. [Codex App Server account API](https://learn.chatgpt.com/docs/app-server)

## Upgrading

Schema 6 retains old settings, operation receipts, historical execution metadata, and waiting messages. A legacy queue can pause for review when permissions or configuration cannot be safely confirmed. Review the effective Codex settings and resume explicitly. [Migration and rollback](conversations.md#metadata-migration-and-rollback)

The previous settings API remains readable for migration. Use `GET /api/projects/:id/codex-configuration` to read effective settings and `PUT` at the same path for a version-checked write. A stale user-layer version returns `409 SETTINGS_CONFLICT`.

See [execution invariants](spec-coding.md) and the [native App Server interface](https://learn.chatgpt.com/docs/app-server).
