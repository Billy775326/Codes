# Codex execution configuration

Open **Settings → Codex configuration** to see the effective model, reasoning, speed, permissions, and native question settings for the selected project. The composer provides compact permission choices, model and reasoning selectors, and a Fast switch. These controls save to the Codex user configuration and display the effective project values after each write. Project overrides remain visible. Open Settings to edit additional native fields using dropdown presets. Existing custom values remain visible. Use **Task mode** in the composer to choose Plan or Execution for new work.

The settings editor saves to the Codex user configuration through the App Server. It shows the effective project value after each save. A trusted project can supply its own value. Reload after a concurrent change before editing again. Versions that cannot safely write settings show the effective configuration for inspection.

## Execution and recovery

Codes creates and resumes threads through the App Server. Effective model, reasoning, service tier, and permissions apply at the next dispatch. Codes refreshes a loaded thread from native runtime metadata when those settings change. Codex reads the Code mode question feature when it loads a native thread. Start a new native conversation to use a changed question setting immediately. Session status displays reported runtime values alongside the next task's effective project settings.

Queued messages carry the prompt, attachments, and requested task mode. They resolve execution configuration at dispatch. **Add to current task** uses the active native turn. Inline and separate review use the native review operation, and branches use the native fork operation.

## Upgrading

Schema 6 retains old settings, operation receipts, historical execution metadata, and waiting messages. Legacy queues pause with a permission review message. Review the active Codex settings before explicitly resuming. Reopening a conversation or restoring the Codes database leaves its native configuration under Codex ownership. Keep a coordinated backup before rolling back across database schema versions.

The previous settings API remains readable for migration. Edit the new configuration through `GET /api/projects/:id/codex-configuration` and `PUT /api/projects/:id/codex-configuration`. The update carries the native user-layer version and the selected changes. Stale versions return `409 SETTINGS_CONFLICT`.

See [Spec Coding](spec-coding.md) for the execution policy and [Codex App Server](https://learn.chatgpt.com/docs/app-server) for the native interface.
