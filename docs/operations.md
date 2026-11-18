# Operations and recovery

Run codes as the Linux account that owns the projects and is already signed in to Codex CLI. Start one codes service per data directory. Use Node 24.x and the pinned CLI version from the [README](../README.md).

## Persistent state

`CODES_DATA_DIR` contains a SQLite database, WAL files, the workspace access token, and a PID lock. Mock mode also stores synthetic history there. The directory defaults to `.local` and is ignored by Git.

Native task transcripts and CLI authentication remain in the server user's Codex home. codes keeps project metadata, settings, execution/branch receipts, pending prompt text, and queued messages with attachment references for recovery. Browser drafts are stored in that browser's local storage, so use a trusted browser profile. Signing out clears the server session, not local drafts. Question answers are not stored as plaintext by the codes operation journal; the CLI may retain them according to its own behavior.

Completed/failed operation receipts are retained for 30 days. Completed/cancelled queue entries are also retained for 30 days. Failed and unknown queue entries remain available for review; remove a failed entry after correcting its cause. Unknown operations are retained until resolved. Treat the data directory and native Codex home as private user data. To back up, stop codes and back up both locations, preserving permissions. Schemas 1–3 are automatically backed up and migrated to schema 4 on startup, retaining queues and branch receipts while adding the review execution lease. See [migration and rollback](conversations.md#metadata-migration-and-rollback). There is no automatic restore tool; unsupported database versions are rejected rather than reset.

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

## HTTPS reverse proxy

The browser and API must share one exact origin. For example, when privately exposing `https://codes.example.com`:

```bash
CODES_HOST=127.0.0.1 \
CODES_PUBLIC_ORIGIN=https://codes.example.com \
CODES_PROJECT_ROOT=/absolute/project/path \
npm start
```

Configure the proxy upstream as `http://127.0.0.1:6670`, preserve `Host: codes.example.com`, disable response buffering for `/api/events`, and allow streaming connections to remain open. Terminate HTTPS at the proxy and restrict access to the intended owner. Origin validation is based on the configured public origin, not on untrusted forwarded headers. Subpath mounting is not supported; use a dedicated origin.

Do not set a browser URL containing the access token. The login form exchanges it for an HttpOnly SameSite cookie; HTTPS origins add Secure. Sessions expire after 12 hours and are lost on service restart. Change the token in the private file or environment, then restart to revoke existing sessions. Logout invalidates its server-side session; an open event stream is closed within its next session check.

## When the page disconnects

A 401 response from the snapshot, sidebar or question/approval API returns an already signed-in page to the login form. Sign in with the existing token to restore the selected conversation and saved composer draft. The browser does not automatically resend messages or answers. An unsubmitted answer inside a question card may need to be entered again; it is not saved as plaintext browser storage.

Permanent snapshot read failures (such as missing history, denied access or a size limit) stop automatic retry and display the cause with **Retry loading**. The composer keeps editable draft text but disables send/model/permission changes until the selected history and task status have loaded. Transient errors and broken streams retain bounded reconnect behavior.

The UI fetches a fresh snapshot, then replays events after its cursor. A server epoch change or replay-buffer overflow requires another snapshot. Reads allow 35 seconds for response headers, then reset a 35-second inactivity deadline as body chunks arrive, with a two-minute overall bound. Writes retain a fixed 35-second deadline. Event handshakes have their own deadline; reconnect retries stop after eight consecutive failures. Click the connection indicator to try again.

If an execution receipt is lost, **do not submit the task a second time**. Use **Check result**. The server checks the recorded operation and matches its exact client message ID in recent native history. A terminal result releases the conversation. A missing receipt means the server did not journal the request; the UI retains the draft so the owner can explicitly send again.

An unknown result that cannot be proven terminal remains locked. Inspect the task through the CLI and resolve the underlying runtime issue. This preview does not provide a force-unlock button. Reconciliation currently scans the latest 12 native turns; an operation displaced by external CLI activity may require manual investigation. Starting a separate conversation does not cancel the previous operation.

## Known preview limits

- One selected conversation receives detailed events in each browser. An idle browser subscribes to project summaries so newly created conversations appear without refreshing.
- The sidebar browses native conversations in pages of up to 30, with separate active/archived views. Case-insensitive title search scans up to four native pages per request; use Next to continue. A failed read retains the displayed portion and offers refresh. The project summary snapshot remains capped at 200; it is not the discovery limit.
- Empty CLI threads are materialized lazily. If the CLI is restarted before the first user message, an empty thread may no longer be readable; create a new conversation.
- Native item display is capped. Huge outputs may exceed the 4 MiB protocol frame and require CLI inspection.
- File context is a checksum-verified copy of selected lines at send time, not a live editor. Hidden paths are intentionally excluded from the file browser.
- The change view shows native current-turn diff events or file-change items from the loaded history. It is not a general Git staging or merge interface.
- The isolated live read/write/interrupt pilot passed. Remote proxy behavior, a real prompting approval policy, and the remaining permission/question variants still require manual acceptance; simulator success is insufficient.

## A forwarded localhost page stays on Connecting

`http://127.0.0.1:6670` in a desktop browser refers to that computer. With SSH forwarding, a healthy service on the Linux server does not by itself prove that the forwarding channel is working. Open `/api/system` at the same desktop address: a JSON response, including an authentication-required response, confirms the HTTP path is reachable at that moment. An authentication error requires signing in; an unavailable or stalled page requires checking the local forward and SSH session. This read does not start a Codex task.

The UI distinguishes timeouts, unreachable requests, invalid API responses and HTTP/proxy failures. A failed snapshot shows its first error while bounded retry continues; Retry loading starts a fresh subscription. Read failures do not imply that a task was submitted. A failed write can still have executed, so Check result verifies its existing operation identity rather than resending it. On reconnect, proven completed or failed receipts can be cleared automatically. Unknown or absent receipts remain protected until checked; an absent receipt found by Check result also refreshes the selected conversation.

Hidden tabs release their event connection and reconnect from a fresh snapshot on return. Native execution and server queues continue while hidden. This reduces HTTP/1 connection occupancy during ordinary tab switching; many simultaneously visible windows can still reach a browser's connection limit. Closing surplus windows or using an HTTPS reverse proxy with HTTP/2 can avoid that separate limit. A private Chrome diagnostic on this host reproduced saturation with six event streams and recovered ordinary requests after releasing one; that diagnostic does not establish the cause of every user connection failure.

### Small API responses work but conversation history stalls

A successful `/api/system` response establishes only that a small request can complete. A conversation snapshot may be much larger because collapsed work history still includes command output. Opening a snapshot directly in a new tab distinguishes an in-page fetch problem from a transfer that also stalls during navigation; do not share its private JSON or session cookies.

Large JSON responses negotiate gzip, retain `Cache-Control: no-store`, and provide `Content-Length` for the actual encoded bytes. Clients that decline gzip receive the same uncompressed JSON. Compression runs asynchronously; it does not modify native history or the event replay cursor. Event streams remain uncompressed.

The browser reports whether a read timed out before any response, stopped making progress while downloading, or exceeded its two-minute total bound. A transport interruption while receiving JSON remains retryable. Switching conversations cancels the old download. These changes do not prove or repair a broken SSH forward, proxy or browser interceptor.

An isolated local Chrome test using an existing 909,611-byte snapshot and a controlled 24 KiB/s download rate reproduced the previous failure at roughly 35 seconds, without model requests. This is evidence for the transfer deadline defect, not a measurement of the owner's desktop network or proof of its sole cause.
