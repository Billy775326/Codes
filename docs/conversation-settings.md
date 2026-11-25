# Codex execution configuration

Open **Settings → Codex configuration** to see the effective model, reasoning, speed, permissions, and native question settings for the selected project. The composer provides the same configuration summary and a link to this page. Use **Task mode** in the composer to choose Plan or Execution for new work.

The settings editor saves to the Codex user configuration through the App Server. It shows the effective project value after each save. A trusted project can supply its own value. Reload after a concurrent change before editing again. Versions that cannot safely write settings show the effective configuration for inspection.

## Execution and recovery

Codes creates and resumes threads through the App Server. Changes to the effective configuration apply at the next dispatch. Codes refreshes a loaded thread from native runtime metadata when its effective configuration changes. Session status displays reported runtime values separately from the next task's effective project settings.

Queued messages carry the prompt, attachments, and requested task mode. They resolve execution configuration at dispatch. **Add to current task** uses the active native turn. Inline and separate review use the native review operation, and branches use the native fork operation.

## Upgrading

Schema 6 retains old settings, operation receipts, historical execution metadata, and waiting messages. Legacy queues pause with a permission review message. Review the active Codex settings before explicitly resuming. Reopening a conversation or restoring the Codes database leaves its native configuration under Codex ownership. Keep a coordinated backup before rolling back across database schema versions.

The previous settings API remains readable for migration. Edit the new configuration through `GET /api/projects/:id/codex-configuration` and `PUT /api/projects/:id/codex-configuration`. The update carries the native user-layer version and the selected changes. Stale versions return `409 SETTINGS_CONFLICT`.

See [Spec Coding](spec-coding.md) for the execution policy and [Codex App Server](https://learn.chatgpt.com/docs/app-server) for the native interface.
