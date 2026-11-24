# Operations and recovery

Run codes as the Linux account that owns the projects and is already signed in to Codex CLI. Start one codes service per data directory. Use Node 24.x and the pinned CLI version from the [README](../README.md).

## Prepare maintenance

Open **Settings → Maintenance** or **Session status** and choose **Prepare maintenance**. Codes stops admitting new tasks, follow-ups and queued messages. Existing tasks can finish, including answering questions and handling approvals. The dispatcher holds existing queued messages without changing their pause settings. **Maintenance ready** means Codes has no outstanding work it can identify, including receipts with an uncertain result. Maintenance expires after five minutes. **Cancel maintenance** resumes normal scheduling early.

An authenticated operator can also POST `{"action":"start"}` or `{"action":"cancel"}` to `/api/maintenance` and read `maintenance.ready` and `maintenance.expiresAt` from `GET /api/system`. Recheck readiness and the expiration immediately before switching. This control gates task admission in the current process. The operator still owns backup, restart and verification.

Record when the old process reaches `maintenance.ready`, when the new build starts, and when it passes verification. This distinguishes a drain timeout from a failure to verify an already switched build. If verification stops after startup, confirm the running build and process before attempting another restart.

After the new HTTP listener accepts authenticated requests, call `GET /api/models` first to initialize the Codex runtime without sending a model prompt. Then check `GET /api/system` for the expected runtime, CLI version and `ready` state. Reading `/api/system` alone can keep reporting `not_started` on a cold process. Verify the database, authenticated endpoints, event stream and browser after the runtime is ready.

## Download a database backup

Open **Settings → Backup & restore → Download database backup** as a signed-in workspace operator. Codes uses SQLite’s online backup to produce one consistent database file while the service runs. The download contains the project list, conversation metadata, queues, operation records and saved conversation defaults. Keep it private. Codex conversation history, project files, uploaded files, server configuration and access credentials have their own backup locations.

Codes prepares one download at a time and caps downloads at 64 MiB. For larger databases or a full recovery bundle, back up the data directory and the effective Codex home on the host. Use SQLite’s online backup for a running database or copy the database after a graceful stop.

To restore a backup from the same database schema:

1. In **Settings → Backup & restore**, choose the SQLite file and select **Prepare restore**. Codes validates it and keeps one prepared backup in its private data directory.
2. Let active work finish and stop Codes gracefully. On the Linux host, run `codes restore-database` as the same user and with the same `CODES_DATA_DIR` as the server. From a built checkout, `npm run restore:database` runs the same operation.
3. Start the service, sign in and check projects, conversation history and queues. Review unresolved operations before resuming any queue.

The restore command acquires the service’s data directory lock and saves the old database in a private `before-restore-*` directory before switching to the validated snapshot. The directory also holds the prepared source for recovery. Use **Remove prepared backup** in the settings page to cancel a prepared restore before applying it. Codex conversation files, project files, images, server settings and access credentials require their own backup and restore process.

## Persistent state

`CODES_DATA_DIR` contains a SQLite database, WAL files, the workspace access token, and a PID lock. Mock mode also stores synthetic history there. The directory defaults to `.local` and is ignored by Git.

Native task transcripts and CLI authentication remain in the server user's Codex home. codes keeps project metadata, settings, execution/branch receipts, pending prompt text, and queued messages with attachment references for recovery. Browser drafts are stored in that browser's local storage, so use a trusted browser profile. Signing out clears the server session, not local drafts. Question answers are not stored as plaintext by the codes operation journal; the CLI may retain them according to its own behavior.

Completed/failed operation receipts are retained for 30 days. Completed/cancelled queue entries are also retained for 30 days. Failed and unknown queue entries remain available for review; remove a failed entry after correcting its cause. Unknown operations are retained until resolved. Treat the data directory and native Codex home as private user data. To back up, stop codes and back up both locations, preserving permissions. Schemas 1–4 are automatically backed up and migrated to schema 5 on startup. The migration covers queue and execution leases, settings, usage, questions, archives, and upload metadata. See [migration and rollback](conversations.md#metadata-migration-and-rollback). There is no automatic restore tool; unsupported database versions are rejected rather than reset.

## Existing Codex conversations

Register an existing conversation's original working directory using Add project. Codes discovers native conversations for that exact directory in Chats and Archived; paginated lists may require moving through their pages. It reuses native thread IDs and history files rather than copying transcripts or changing working directories. Existing Codes settings and receipts remain independent. Newly discovered conversations start with Read only for future Codes tasks; this does not rewrite the original CLI configuration.

Both legacy and paginated native histories are readable. Legacy stores use full items from one native turn at a time; paginated stores use item pages. The same display limits apply, and a genuinely empty native history remains empty. Importing a registration does not reconstruct deleted or incompatible source records. See [history and transport limits](architecture.md).

## Imported conversations still open in another client

Import registers the original native thread and directory; it does not transfer that thread's writer ownership. Codex CLI 0.167.0 keeps a cross-process file lock while a client owns a loaded conversation, even between model turns. The native error `thread <id> already has an active writer` means another client (for example Covro) still owns it.

History remains readable. Codes reports this as `THREAD_WRITER_BUSY`, preserves the prior task outcome and the unsent draft, and does not resend the rejected task. Close/unload the source conversation in its owning client, then use **Check availability**. Closing a browser tab alone does not necessarily release its server-side writer. This resumes the thread without a model prompt; sending again remains an explicit action. If the source must stay open, **Continue in branch** offers the existing confirmation dialog, copies history through the latest recent completed/interrupted/failed turn to a new native thread, and carries the unsent draft and attachments. It does not copy later unfinished work, change source history, roll back files or automatically send the draft. The new branch starts in Read only. Queues stopped by contention require explicit review/resumption.

Do not delete an in-use lock or kill an unrelated client to make the error disappear. Native lock ownership is enforced by Codex, not by a second application lock. See the pinned [writer implementation](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/rollout/src/writer_lock.rs).

Imported Covro answers may be stored in `send_user_message_question_reply` text envelopes. Codes formats well-formed, bounded envelopes as answered question/answer text and matches them to structured asynchronous questions when native history supplies a question ID. Native `item/tool/requestUserInput` callbacks use their existing lifecycle. Questions delivered on agent messages stay in the original turn, with sidebar attention independent of task completion. Submitting an asynchronous answer adds it to the running turn or starts a follow-up in that conversation. Skip only ends local tracking.

## Project directory recovery

The selected conversation's server-verified project supplies its working directory and file context. If it is missing or inaccessible, the UI keeps history and saved settings visible, disables new execution/filesystem actions, and offers **Retry directory**. Restore the registered canonical directory or its search permissions, then retry. Choosing another project starts or restores that project's own conversation; Codes does not move an existing transcript or silently substitute a directory.

Waiting queues retain their entries and pause before dispatch when the directory is unavailable. After recovery, explicitly resume the queue. Stop remains available for an existing task. A configured `CODES_PROJECT_ROOT` that exactly matches an existing canonical registration can be absent during startup; history still opens. A new invalid startup path or registration reports an error instead of replacing the saved project.

Filesystem errors distinguish `DIRECTORY_UNAVAILABLE` (409), `DIRECTORY_ACCESS` (403), `FILE_NOT_FOUND` (404), and `FILE_ACCESS` (403). Native ownership disagreements use `PROJECT_OWNERSHIP` (403). Native tool sandbox/approval policy remains separate. See [project and conversation navigation](session-navigation-proposal.md).

## Process lifecycle

`SIGTERM` and `SIGINT` close the event streams, stop the child CLI, close SQLite, and remove the lock. A PID lock prevents two instances from using the same data directory. A stale lock is removed only when its process no longer exists. If a PID has been reused, inspect the lock and process manually rather than deleting an in-use lock.

Restarting the service does not promise that a running CLI tool will finish. Unresolved sends become unknown and old approval callbacks expire. Browser closure alone leaves the server task and its unpaused queue running. On service restart, waiting queues are preserved and paused; possibly dispatched messages become unknown. Check their results, then resume explicitly. See [queue recovery](conversation-workflow.md#queue-recovery).

Use your normal process supervisor with a private environment and an explicit working directory. The repository does not install a daemon or change the running host configuration.

### Updating the owner's local preview

The owner authorized the following delivery policy on 2026-11-18: after a verified codes update, build and switch the existing local preview on port 6670 by default. This is the development delivery workflow, not a background update service. The `codes` command remains a foreground launcher; it does not replace an occupied instance automatically.

1. Check the target commit, working-tree changes, relevant validation and CI. Build in an isolated directory so the running frontend and backend keep matching.
2. Inspect execution receipts, active native work and queued messages. Prepare the build while busy, and wait for work to finish before switching. Never silently interrupt a task or resend an uncertain operation for an update.
3. Preserve the existing process environment privately, stop that exact service gracefully, and back up SQLite consistently, the access token and previous build. Retain migration backups and the schema rollback restrictions described below.
4. Install the prepared build and start with the same data directory, origin and listener. Verify schema/integrity, retained records/token, native readiness, authenticated APIs, SSE and the browser flow without sending a model prompt.
5. Record the target commit, PID, backup location and verification result in the ignored local upgrade receipt. Report the actual running build. Existing browser sessions expire on restart; use the same token to sign in again.

Release tags, GitHub Releases, package publishing and a new public deployment still require their own authorization.

### Updating only the web interface

For an API-compatible frontend change, run `npm run build` in an isolated checkout, then run `npm run preview:web -- install /absolute/path/to/candidate/dist` from the active Codes checkout. The command checks that the candidate backend output and unversioned public files match. It retains the existing hashed assets and atomically switches the HTML entry. Sign-in, event streams and running tasks stay connected. Open pages mark the existing reload control when they detect the new entry.

Run `npm run preview:web -- rollback` from the active checkout to restore the previous entry. Use the full maintenance flow for backend changes, shared protocol changes, unversioned assets or a full asset budget. Run one preview update at a time.

## Network and access

In **Settings → Network & access**, choose a loopback listener (`127.0.0.1`, `localhost`, or `::1`) and a port from 1 to 65535. On Linux, low ports may require additional bind permissions. Add one allowed HTTP(S) origin per line, including the external HTTPS URL when using a proxy. Allowed addresses control which browser origins Codes accepts. The listener address and port control where the process binds.

Save, then restart Codes with the same data directory and sign in at the new address. The listener section shows the active address and the saved address for the next restart when they differ. The sign-in page shows the current browser origin, which can be a proxy address. Existing local HTTP entries on the old port follow an edited listener port until you edit the address list yourself. If you proxy or forward the listener, update that upstream or forward before visiting it again.

Codes stores the saved settings in `network-settings.json` in the private data directory. The saved settings take precedence over `CODES_HOST`, `CODES_PORT`, and `CODES_PUBLIC_ORIGIN`. If a saved setting prevents access, stop the service, move that file elsewhere as a backup, and restart with the desired environment values. Without a settings file, `CODES_PUBLIC_ORIGIN` still selects one exact browser origin. The defaults allow the local loopback origins on port 6670.

**Export saved** downloads the listener addresses and authentication settings as a versioned Codes JSON file. **Import configuration** loads a Codes export into the editable form. Review the addresses and authentication, then explicitly save when ready. The export contains settings such as the Access team URL and AUD, with no workspace token or native credentials.

**Local / Tailscale** uses the Codes access token. For tailnet access, have Tailscale Serve forward to the loopback listener and add its HTTPS origin.

### Cloudflare Access

1. Create a self-hosted Access application for the entire public hostname and allow your identity. If using Cloudflare Tunnel, enable **Protect with Access** and keep the upstream on the Codes loopback listener. Preserve the public Host and the `Cf-Access-Jwt-Assertion` header when forwarding. [Cloudflare setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
2. In **Settings → Network & access**, select **Cloudflare Access**, enter the team URL (`https://your-team.cloudflareaccess.com`) and the application's AUD tag from Cloudflare Zero Trust, and list the HTTPS origins covered by that application. [Find the AUD tag](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag)
3. Save and restart the built Codes server. Open the public HTTPS origin, sign in through Access, and then enter your Codes token. Codes verifies the signed Access assertion on every request and closes event streams when its token expires. Use the recovery procedure above if you need to undo the change from the host.

### HTTPS reverse proxy

The browser and API must share one exact origin. For example, when privately exposing `https://codes.example.com`:

```bash
CODES_HOST=127.0.0.1 \
CODES_PUBLIC_ORIGIN=https://codes.example.com \
CODES_PROJECT_ROOT=/absolute/project/path \
npm start
```

Configure the proxy upstream as `http://127.0.0.1:6670`, preserve `Host: codes.example.com`, disable response buffering for `/api/events`, and allow streaming connections to remain open. Terminate HTTPS at the proxy and restrict access to the intended owner. A browser write must use an allowed origin whose hostname and port match the request's Host header. Use a dedicated origin for Codes.

Do not set a browser URL containing the access token. The login form exchanges it for an HttpOnly SameSite cookie; HTTPS origins add Secure. Sessions expire after 12 hours by default. Change the duration for future sign-ins under **Settings → Network & access → Sign-in session**. Existing sessions keep their expiry and are lost on service restart. Logout invalidates its server-side session. An open event stream closes on its next session check.

### Change the access token

With a file-backed token, open **Settings → Network & access → Access token**, enter the current token, then enter and confirm the replacement. Use 16–256 characters without surrounding whitespace or control characters. Codes writes the replacement atomically to the private `access-token` file, immediately ends all browser sessions and event streams, and accepts the replacement for subsequent sign-ins. Running tasks and queued work continue on the server.

If the process was started with `CODES_ACCESS_TOKEN`, that environment value remains authoritative. Update it in the service environment and restart. Keep the token private. The settings API and configuration exports contain no token value.

## Runtime settings

In **Settings → Runtime**, set the default native RPC deadline (1,000–300,000 ms) and whether native questions are available in Code mode. The form also shows the Codex executable and Codes data directory. Save and restart Codes to apply changes. `runtime-settings.json` in the private data directory takes precedence over `CODES_CODE_QUESTIONS` and `CODES_CODEX_REQUEST_TIMEOUT_MS`. Before a save, Code-mode questions are enabled when the installed CLI supports them and the native request deadline is 30,000 ms. Operations with dedicated deadlines retain those deadlines.

To recover from invalid runtime settings, stop Codes, move `runtime-settings.json` to a backup outside the active path, and restart with the desired environment values.

## Browser notifications

Enable **Browser notifications** in **Settings → Preferences** and allow the site to display notifications. Use **Send test notification** to verify delivery. With notifications enabled, an open background Codes tab keeps its existing event connection and can report completion, failure, stops, approvals and questions. Notification titles use generic text. Browser support requires a secure context, such as HTTPS or localhost. Delivery depends on the browser keeping the tab and connection active.

## When the page disconnects

Use **Reload page** in the workspace header to reload Codes. The selected conversation and saved text draft are restored, and active tasks continue on the server. Codes asks for confirmation if a reload would discard unsent attachments or an open queue edit.

A 401 response from the snapshot, sidebar or question/approval API returns an already signed-in page to the login form. Sign in with the existing token to restore the selected conversation and saved composer draft. The browser does not automatically resend messages or answers. An unsubmitted answer inside a question card may need to be entered again; it is not saved as plaintext browser storage.

Permanent snapshot read failures (such as missing history, denied access or a size limit) stop automatic retry and display the cause with **Retry loading**. The composer keeps editable draft text but disables send/model/permission changes until the selected history and task status have loaded. Transient errors and broken streams retain bounded reconnect behavior.

The UI fetches a fresh snapshot, then replays events after its cursor. A server epoch change or replay-buffer overflow requires another snapshot. Reads allow 35 seconds for response headers, then reset a 35-second inactivity deadline as body chunks arrive, with a two-minute overall bound. Writes retain a fixed 35-second deadline. Event handshakes have their own deadline; reconnect retries stop after eight consecutive failures. Click the connection indicator to try again.

If an execution receipt is lost, **do not submit the task a second time**. Use **Check result**. The server checks the recorded operation and matches its exact client message ID in recent native history. A terminal result releases the conversation. A missing receipt means the server did not journal the request; the UI retains the draft so the owner can explicitly send again.

An unknown result that cannot be proven terminal remains locked. Inspect the task through the CLI and resolve the underlying runtime issue. This preview does not provide a force-unlock button. Reconciliation currently scans the latest 12 native turns; an operation displaced by external CLI activity may require manual investigation. Starting a separate conversation does not cancel the previous operation.

### Read diagnostics

Snapshot, history and event-stream requests expose an `X-Request-Id` header. Slow reads, failures and replay resets produce one JSON log record with the request ID, safe conversation ID, elapsed time, queue and native RPC phases, and response bytes when available. Use **Settings → Maintenance → Connection diagnostics** to include successful reads for 5, 15 or 30 minutes. You can stop logging early. Use `CODES_READ_DIAGNOSTICS=1` for sustained logging from process startup. The records omit message bodies, credentials and filesystem paths.

## Known preview limits

- One selected conversation receives detailed events in each browser. An idle browser subscribes to project summaries so newly created conversations appear without refreshing.
- The sidebar browses native conversations in pages of up to 30, with separate active/archived views. Case-insensitive title search scans up to four native pages per request; use Next to continue. A failed read retains the displayed portion and offers refresh. The project summary snapshot remains capped at 200; it is not the discovery limit.
- Empty CLI threads are materialized lazily. If the CLI is restarted before the first user message, an empty thread may no longer be readable; create a new conversation.
- Native item display is capped. History reads fetch one native item per response and use a 16 MiB JSONL frame limit. Larger individual native items require CLI inspection. A recognizable oversized history response can be skipped without ending other tasks. An invalid or unidentifiable frame still ends the shared connection and leaves unconfirmed operations protected.
- File context is a checksum-verified copy of selected lines at send time. Hidden entries are off in a fresh browser. **Show hidden files** is shared by the Files toolbar and Settings → Preferences, and the choice is saved in the browser.
- The change view shows native current-turn diff events or file-change items from the loaded history. It is not a general Git staging or merge interface.
- The isolated live read/write/interrupt pilot passed. Remote proxy behavior, a real prompting approval policy, and the remaining permission/question variants still require manual acceptance; simulator success is insufficient.

## A forwarded localhost page stays on Connecting

`http://127.0.0.1:6670` in a desktop browser refers to that computer. With SSH forwarding, a healthy service on the Linux server does not by itself prove that the forwarding channel is working. Open `/api/system` at the same desktop address: a JSON response, including an authentication-required response, confirms the HTTP path is reachable at that moment. An authentication error requires signing in; an unavailable or stalled page requires checking the local forward and SSH session. This read does not start a Codex task.

The UI distinguishes timeouts, unreachable requests, invalid API responses and HTTP/proxy failures. A failed snapshot shows its first error while bounded retry continues; Retry loading starts a fresh subscription. Read failures do not imply that a task was submitted. A failed write can still have executed, so Check result verifies its existing operation identity rather than resending it. On reconnect, proven completed or failed receipts can be cleared automatically. Unknown or absent receipts remain protected until checked; an absent receipt found by Check result also refreshes the selected conversation.

Hidden tabs release their event connection and reconnect from a fresh snapshot on return by default. Opting into browser notifications keeps the existing connection open. Native execution and server queues continue while hidden. This reduces HTTP/1 connection occupancy during ordinary tab switching; many simultaneously visible windows can still reach a browser's connection limit. Closing surplus windows or using an HTTPS reverse proxy with HTTP/2 can avoid that separate limit. A private Chrome diagnostic on this host reproduced saturation with six event streams and recovered ordinary requests after releasing one; that diagnostic does not establish the cause of every user connection failure.

### Small API responses work but conversation history stalls

A successful `/api/system` response establishes only that a small request can complete. A conversation snapshot may be much larger because collapsed work history still includes command output. Opening a snapshot directly in a new tab distinguishes an in-page fetch problem from a transfer that also stalls during navigation; do not share its private JSON or session cookies.

Large JSON responses negotiate gzip, retain `Cache-Control: no-store`, and provide `Content-Length` for the actual encoded bytes. Clients that decline gzip receive the same uncompressed JSON. Compression runs asynchronously; it does not modify native history or the event replay cursor. Event streams remain uncompressed.

The browser reports whether a read timed out before any response, stopped making progress while downloading, or exceeded its two-minute total bound. A transport interruption while receiving JSON remains retryable. Switching conversations cancels the old download. These changes do not prove or repair a broken SSH forward, proxy or browser interceptor.

An isolated local Chrome test using an existing 909,611-byte snapshot and a controlled 24 KiB/s download rate reproduced the previous failure at roughly 35 seconds, without model requests. This is evidence for the transfer deadline defect, not a measurement of the owner's desktop network or proof of its sole cause.
