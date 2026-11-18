# Operations and recovery

Run codes as the Linux account that owns the projects and is already signed in to Codex CLI. Start one codes service per data directory. Use Node 24.x and the pinned CLI version from the [README](../README.md).

## Persistent state

`CODES_DATA_DIR` contains a SQLite database, WAL files, the workspace access token, and a PID lock. Mock mode also stores synthetic history there. The directory defaults to `.local` and is ignored by Git.

Native task transcripts and CLI authentication remain in the server user's Codex home. codes keeps project metadata, settings, execution/branch receipts, pending prompt text, and queued messages with attachment references for recovery. Browser drafts are stored in that browser's local storage, so use a trusted browser profile. Signing out clears the server session, not local drafts. Question answers are not stored as plaintext by the codes operation journal; the CLI may retain them according to its own behavior.

Completed/failed operation receipts are retained for 30 days. Completed/cancelled queue entries are also retained for 30 days. Failed and unknown queue entries remain available for review; remove a failed entry after correcting its cause. Unknown operations are retained until resolved. Treat the data directory and native Codex home as private user data. To back up, stop codes and back up both locations, preserving permissions. Schema 1 and 2 are automatically backed up and migrated to schema 3 on startup to add durable queues and branch receipts. See [migration and rollback](conversations.md#metadata-migration-and-rollback). There is no automatic restore tool; unsupported database versions are rejected rather than reset.

## Process lifecycle

`SIGTERM` and `SIGINT` close the event streams, stop the child CLI, close SQLite, and remove the lock. A PID lock prevents two instances from using the same data directory. A stale lock is removed only when its process no longer exists. If a PID has been reused, inspect the lock and process manually rather than deleting an in-use lock.

Restarting the service does not promise that a running CLI tool will finish. Unresolved sends become unknown and old approval callbacks expire. Browser closure alone leaves the server task and its unpaused queue running. On service restart, waiting queues are preserved and paused; possibly dispatched messages become unknown. Check their results, then resume explicitly. See [queue recovery](conversation-workflow.md#queue-recovery).

Use your normal process supervisor with a private environment and an explicit working directory. The repository does not install a daemon or change the running host configuration.

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

The UI fetches a fresh snapshot, then replays events after its cursor. A server epoch change or replay-buffer overflow requires another snapshot. Read requests and event handshakes have deadlines; reconnect retries stop after eight consecutive failures. Click the connection indicator to try again.

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
