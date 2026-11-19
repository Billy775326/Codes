# Conversation settings and new-conversation defaults

Permissions and **Model and reasoning** belong to the selected conversation. A change saves immediately on the server, without sending a model prompt. The selection persists when switching conversations, reloading, restarting codes, or opening the same conversation on another device. It includes model, reasoning effort, Fast, and Execution / Plan mode. Choosing another model resets its reasoning and Fast overrides to compatible defaults.

Use **Interaction settings → New conversation defaults** for the starting permissions, model, reasoning effort, mode, and Fast setting of subsequent normal conversations. Defaults are shared by this single-owner workspace. Existing conversations retain their own settings. The initial default remains Read only, with the native default model/effort, Execution, and Standard speed. Changing these preferences does not edit global Codex configuration.

The New conversation action starts with the current saved defaults. Before a conversation has been created, its text and customized settings are browser-only, project-scoped drafts; up to 20 new-draft setting records are retained. Reload restores that draft choice. Once created, conversation settings are server-backed. Branches retain their existing Read only starting policy, and reviews retain their native read-only execution policy.

## Approve for me

The permission menu and New conversation defaults include **Approve for me** (`permission: "auto-review"`). It maps to native workspace-write sandboxing, on-request approval, and `approvalsReviewer: "auto_review"`. Read only, Ask for approval, and Full access explicitly select the native human reviewer (`"user"`); Full access also disables approval prompts. No global CLI configuration is edited and no Codes code automatically accepts a callback.

Native managed requirements can disable this choice. Authenticated `GET /api/permissions` returns only `{ autoReview: boolean }`, derived from native reviewer, approval-policy, and sandbox allowlists. This reflects policy permission, not guaranteed account/quota availability. A native rejection stays visible; Codes never falls back to Full access. The native reviewer may use extra quota. When emitted, review status and bounded rationale appear in work history; these transient notifications are not a separate durable reviewer journal.

The saved preset is additive to schema 4. Older Codes builds cannot validate the new `auto-review` value. Before an application downgrade, choose an older supported preset for affected profiles and queue entries, or restore a coordinated backup; never silently reinterpret it as another permission.

See [official Auto-review behavior](https://learn.chatgpt.com/docs/sandboxing/auto-review).

## Running and queued work

Conversation preferences are separate from the configuration captured for an executing task. Editing the preferences does not reconfigure an active task or rewrite already queued messages. New queued entries capture the current conversation settings. When those entries later execute, they do not overwrite newer conversation preferences.

Immediate additions use the running task's settings. If the draft's selected settings differ, Queue becomes the primary follow-up action and Add now is unavailable for that draft. A queued entry can still use Guide now if its own captured settings match the running task. Session status describes the actual task settings; the composer shows the saved configuration for future work.

## Saving and recovery

The browser serializes writes and retains the latest choice during rapid changes. Controls remain usable while saving so focus stays in place. Task dispatch waits for the latest save. Switching conversations does not cancel an authorized settings write or allow its acknowledgement to change another conversation.

Revision checks reject stale writes from another window. A conflicting local choice remains visible until **Reload settings** retrieves the saved configuration. If an acknowledgement is lost, codes reads the profile to check whether the selection was saved. A failed save retains the requested choice and offers **Retry settings**; it does not create a task receipt or resend a model prompt.

## Storage and API

Schema 4 remains supported. An additive `setting_profiles` table stores settings separately from execution snapshots, using a scope key and an integer revision. Existing conversations are seeded once from their last stored task configuration. Subsequent task/history refreshes preserve those preferences. Back up the database with the existing runtime data. Older builds ignore this table; preferences remain available when returning to a build that supports it.

Authenticated endpoints:

| Endpoint                    | GET                            | PUT                               |
| --------------------------- | ------------------------------ | --------------------------------- |
| `/api/settings/defaults`    | Read new-conversation defaults | Save workspace defaults           |
| `/api/threads/:id/settings` | Read conversation settings     | Save future conversation settings |

Responses contain `{ revision, settings }`. PUT sends the same shape; permissions are required, and model, effort, fast and mode are optional. A stale, different update returns `409 SETTINGS_CONFLICT`; repeating an already saved selection returns the current profile. Invalid data returns 400, an unknown conversation returns 404, and archived or managed conversations reject changes with 409. PUT is idempotent for the selected value. `POST /api/projects/:id/threads` also accepts `{}` to create using the current defaults; explicit settings remain supported.

Thread snapshots include `composerSettings` alongside the task's `settings`. Scoped `settings` events update the selected conversation profile; global `defaults` events synchronize workspace defaults. No additional event stream is opened. Stored invalid profile data reports an error rather than silently resetting permissions.

Simulator regressions cover storage/restart, independent conversations, captured execution and queue settings, conflicts, lost acknowledgements, retries, rapid edits, and desktop/mobile modal behavior. Native metadata checks and actual preview checks are separate from model execution acceptance.
