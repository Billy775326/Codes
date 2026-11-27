# Operate and recover Codes

Run Codes under the Linux account that owns the projects and is signed in to Codex. Use one service per data directory. See the [quick start](../README.md#quick-start) and [startup environment](configuration.md#startup-environment).

## Install or upgrade a release

The [release installer](../README.md#install-codes) needs Bash, curl, GNU tar and coreutils, and `flock` from util-linux. The Linux x64 and ARM64 bundles include the Node.js runtime and JavaScript dependencies. Codex CLI and its login come from the host account.

Install runs as your user and places releases in `$XDG_DATA_HOME/codes-app` or `~/.local/share/codes-app`, with a launcher in `~/.local/bin`. Configure these locations with `CODES_APP_DIR` and `CODES_BIN_DIR` respectively. The launcher directs commands to the installed version. The workspace database and token use the usual data directory.

The interactive installer asks for an initial browser language and listener port on a new workspace. With no terminal, it uses English and port 6670. Set `CODES_LANGUAGE` to `en` or `zh-CN` and `CODES_PORT` to an available loopback port to supply those answers. The browser keeps language preferences already saved on that device.

For a fresh installation using the default browser origins, the installer also adds the host's IPv4 and unscoped IPv6 addresses on the chosen port to **Allowed addresses**. The listener still binds to loopback. To reach it from another machine, use the forwarding or proxy options below. `CODES_PUBLIC_ORIGIN` supplies an explicit initial origin. Reinstalls and upgrades keep the saved list.

The installer generates a private workspace token and prints the token, file path, and workspace URL. Reinstalling the same version while Codes is stopped replaces the file-backed token and prints the replacement. Stop Codes before reinstalling. An upgrade to a different release keeps the existing token. Workspaces using `CODES_ACCESS_TOKEN` obtain their token from the startup environment.

Before upgrading, let work finish and stop Codes with the current launcher. Run the installer for the desired release, then start Codes with the same environment. An existing source-checkout launcher can coexist by setting `CODES_BIN_DIR` to a different directory. To open data from a checkout that uses `.local`, set `CODES_DATA_DIR` to that directory and stop the old instance before starting the installed release. The source checkout and Codex home remain in place.

## Network and access

Codes binds to loopback. For desktop access over SSH, start this tunnel on your own computer, then open [http://127.0.0.1:6670](http://127.0.0.1:6670) there.

```bash
ssh -L 6670:127.0.0.1:6670 user@your-linux-host
```

In **Settings → Network & access**, set the listener address, port, and exact HTTP(S) browser origins. The listener uses `127.0.0.1`, `localhost`, or `::1` and a port from 1 to 65535. An allowed origin includes the scheme, hostname, and port when required. Use one origin per line. Saved settings override the initial listener environment.

Review the saved and active settings, then restart with the same data directory to apply listener changes. Update any proxy upstream or SSH forward when the listener port changes. **Local / Tailscale** uses the Codes workspace token. Tailscale Serve can forward a permitted tailnet HTTPS origin to the same loopback listener.

Use **Settings → Backup & restore → Network configuration** to export a versioned JSON file of saved network settings or to import it. An import opens **Network & access** with a draft for review and explicit save. Workspace tokens and Codex credentials stay in their own storage.

If saved network settings prevent access, stop the service, move `network-settings.json` to a private backup outside the active path, then restart with the desired environment. A `HOST_DENIED` response usually means the forwarded Host is missing from the allowed origins or changed at the proxy.

### HTTPS reverse proxy

Use a dedicated HTTPS origin for the browser and API. In this example, Codes permits one external origin when it starts without saved network settings.

```bash
CODES_HOST=127.0.0.1 \
CODES_PUBLIC_ORIGIN=https://codes.example.com \
npm start
```

Forward to `http://127.0.0.1:6670`, preserve `Host: codes.example.com`, and leave `/api/events` unbuffered for server-sent events. Restrict the HTTPS entry to the intended workspace owner. Browser writes require a permitted Origin that matches the forwarded Host.

Codes exchanges the workspace token for an HttpOnly SameSite cookie and sets Secure for HTTPS. Enter the token in the sign-in form. The default session lasts 12 hours. Edit the lifetime for future sign-ins under **Network & access → Sign-in session**. Restart or sign out to end the applicable browser session.

### Cloudflare Access

1. Create a self-hosted Access application covering the Codes hostname and authorize your identity. If using a Tunnel, enable **Protect with Access** and forward to the Codes loopback listener. Preserve the Host and `Cf-Access-Jwt-Assertion` header. [Cloudflare Access setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
2. Select **Cloudflare Access** in **Network & access**, enter the team URL and the application AUD, and list the covered HTTPS origins. [Find the application AUD](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag)
3. Save and restart the built server. Access the site through Cloudflare, then sign in with the Codes token. Codes verifies the Access assertion on each request and closes event streams when the assertion expires.

### Change the access token

In **Network & access → Access token**, enter the current file-backed token and a replacement of 16–256 characters. Codes updates the file atomically and revokes browser sessions and event streams. Running work continues.

If the service uses `CODES_ACCESS_TOKEN`, change that value in the service environment and restart. Keep the token private.

## Process lifecycle

| Command         | Behavior                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `codes`         | Run in the foreground. Press Ctrl+C to stop.                                                                                              |
| `codes start`   | Start in the background and wait for the listener. Output goes to the data directory's private `server.log`.                              |
| `codes status`  | Show the running PID and data directory. The exit status is 0 for a verified running instance and 1 for a stopped or unverified instance. |
| `codes stop`    | Send SIGTERM to the verified instance and wait for it to exit. An already stopped instance returns success.                               |
| `codes restart` | Stop the verified instance and start in the background with its original startup environment. If stopped, use the current environment.    |

Use `codes help` (also `-h` or `--help`) for command usage. `codes logs` prints up to 50 recent lines from `server.log`. Use `codes logs -f` to keep reading. Ctrl+C exits the log viewer. A foreground `codes` process normally writes to its terminal. A supervisor can redirect that output to its own log.

`codes doctor` checks the platform, Node.js, build, data-directory access, process identity, Codex CLI version, saved settings, and the configured loopback listener. For a verified running process, it uses its startup environment when available. The configured listener can differ from the running listener when a saved change needs a restart. Diagnostics report failed checks with exit status 1.

The launcher checks the Linux process identity, data directory lock, and open database before signaling. Shutdown closes event streams, stops the child CLI, closes SQLite, and releases the lock. If the foreground process predates the launcher metadata and used relative project or CLI executable paths, stop it and start with the intended environment to update those paths.

Closing a browser tab leaves work running. A service restart can interrupt tools, expire approvals, or leave a running operation unresolved. Waiting messages survive and start paused. Use **Check result** for uncertain work before resuming a queue. [Queue recovery](conversation-workflow.md#queue-recovery)

Use the supervisor's lifecycle commands for services it manages. Configure its working directory and environment explicitly.

## Prepare maintenance

Choose **Prepare maintenance** in **Settings → Maintenance** or **Session status**. New tasks, follow-ups, and queue dispatch pause while active tasks can still finish and receive responses. **Maintenance ready** indicates that Codes found no active work or uncertain receipts in its own runtime. The gate expires after five minutes. Use **Cancel maintenance** to release it early.

For automation, sign in and POST `{"action":"start"}` or `{"action":"cancel"}` to `/api/maintenance`. Read `maintenance.ready` and `maintenance.expiresAt` from `GET /api/system`. Recheck both just before stopping the process.

### Updating the owner's local preview

The owner authorized updates of the existing local preview at port 6670 after a verified build on 2026-11-18. Use this procedure for a change to the server or its protocol.

1. Identify the target commit and running process. Build and verify the candidate in an isolated directory.
2. Let existing work finish and confirm maintenance readiness. Stop that process gracefully.
3. Back up the private configuration, token, old build, and consistent database. Update the build and any matching dependencies. Restart using the same service environment, origin, and data directory.
4. Verify the database and retained records, sign in, then call `GET /api/models` to initialize the runtime without a model prompt. Check the expected CLI version and ready state in `GET /api/system`. Verify event streaming and the changed browser workflow.
5. Record the commit, PID, backup path, and verification outcome in the ignored local receipt. Existing browser sessions need to sign in again with the same token.

For a new public deployment or formal release, use the repository's separate release and deployment authorization.

### Updating only the web interface

Build an API-compatible candidate in an isolated checkout, then run the install command from the live checkout.

```bash
npm run preview:web -- install /absolute/path/to/candidate/dist
```

The command checks matching backend output and unversioned public assets, retains existing versioned assets, and switches the HTML entry atomically. The workspace header can indicate that a reload is available. Use `npm run preview:web -- rollback` to restore the previous entry. Use a full maintenance update for server, protocol, or unversioned asset changes.

## Persistent state

| Location                                          | Contents                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `CODES_DATA_DIR` (default `~/.local/share/codes`) | Codes SQLite database, workspace settings, access token, image files, server lock, and simulator history when used |
| Codex home                                        | Native configuration, login, and Codex conversation history                                                        |
| Project directories                               | Source, user files, and originals uploaded into the project                                                        |
| Browser local storage                             | Text drafts, selected views, and preferences                                                                       |

Codes retains completed or failed operation receipts and completed or cancelled queue entries for 30 days. Unknown receipts and waiting or unresolved queue entries remain available for recovery. Protect the data directory and Codex home with the service account's permissions. [Schema and rollback](conversations.md#metadata-migration-and-rollback)

## Download a database backup

In **Settings → Backup & restore → Workspace database**, select **Download database backup**. Codes takes one consistent SQLite snapshot at a time, up to 64 MiB. It includes workspace metadata, receipts, and queues. For a larger database, use a host-side SQLite backup or copy the database after a graceful stop. Back up native history, project files, images, and configuration separately for full recovery.

1. Select a same-schema SQLite snapshot in **Backup & restore** and choose **Prepare restore**.
2. Let active work finish, stop the service, and run `codes restore-database` as the service user with the same data directory. In a built checkout, `npm run restore:database` is equivalent.
3. Restart, sign in, and verify native histories, working directories, and queues before resuming work.

Codes locks the data directory, writes the original database to a private `before-restore-*` recovery directory, then installs the validated snapshot. Use **Remove prepared backup** to cancel a staged restore. [Migration backups and cross-version rollback](conversations.md#metadata-migration-and-rollback)

## Existing Codex conversations

Run Codes with the same Linux account and effective `CODEX_HOME` as your CLI. Search **Active** or **Archived** across all working directories. Codes opens the native thread ID and reads both legacy and paginated history. [Conversations](conversations.md)

### Imported conversations still open in another client

`THREAD_WRITER_BUSY` means a native client still owns the thread. History and the current draft remain available. Close or unload the thread in the owning client, then choose **Check availability** to retry opening the writer without sending a prompt.

Use **Continue in branch** when the source must remain open. The branch includes history through the latest eligible terminal turn and carries the unsent draft and attachments. Check queued work before resuming after contention. [Native writer locking at CLI 0.167.0](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/rollout/src/writer_lock.rs)

## Working directory recovery

Restore the original working directory or its access permissions and choose **Retry directory**. Historical messages remain available while new execution and project file access are blocked. A waiting queue may need an explicit resume after recovery. [Working directories](conversations.md#working-directories)

## Runtime settings

Use **Settings → Codex CLI** to change the general native RPC deadline from 1,000 to 300,000 ms. The usual default is 30,000 ms. Specialized operations keep their own deadlines. The saved value takes effect on restart. To recover from invalid settings, stop Codes, preserve the old `runtime-settings.json` outside its active path, and restart using the desired environment. [Execution features](conversation-settings.md)

## Browser notifications

Open **Settings → Notifications**, allow notifications in your browser, and use **Send test notification**. With notifications enabled, an open background tab can report selected task and interaction events. Browser support requires a secure context such as HTTPS or localhost, plus an active event connection.

## When the page disconnects

| What you see                                  | What to do                                                                                                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in returns after an authentication error | Sign in with the current Codes token. Codes restores the selected conversation and saved draft where available.                                                                                           |
| **Reconnect updates**                         | Retry the snapshot and event subscription after checking network connectivity.                                                                                                                            |
| **Retry loading**                             | Read the displayed error, then retry access or loading. The draft remains editable while sending waits for the current conversation.                                                                      |
| **Check result** on a sent task               | Verify the recorded operation instead of creating another. A confirmed terminal result releases the task. If Codes confirms there is no receipt, review the retained draft before choosing to send again. |
| **Reload page**                               | Reload the web entry and restore the selected conversation and saved text draft. Codes confirms when unsent attachments or an open queue edit would be lost.                                              |

Unknown results remain protected while matching terminal evidence is unavailable. Reconciliation searches recent native work with a bounded window. Inspect the native conversation for older or unresolved cases. [Execution and recovery](architecture.md#execution-and-recovery)

### Read diagnostics

Inspect `X-Request-Id` in snapshot, history, or stream responses. Codes logs slow or failed reads and replay resets with safe IDs, stages, elapsed times, and sizes when available. In **Maintenance → Connection diagnostics**, include successful requests for 5, 15, or 30 minutes. Use `CODES_READ_DIAGNOSTICS=1` for startup logging. Diagnostic records exclude message contents, filesystem paths, and credentials.

### A forwarded localhost page stays on Connecting

The desktop browser's loopback address is the desktop, even when Codes runs on another host. Test `/api/system` through the same browser address. An authentication-required response confirms that HTTP reached Codes. A stalled request points to the local forwarding, connection, or proxy path. Sign in before testing private conversation endpoints.

### Small API responses work but conversation history stalls

Check a request's headers, transfer progress, and request ID. A large snapshot can include collapsed tool activity. Read requests allow 35 seconds before or between data and up to two minutes for the whole response. Gzip is negotiated for large JSON responses. Event streams remain uncompressed. [Rendering and resource limits](architecture.md#rendering-and-resource-limits)

Hidden tabs normally release their stream and take a fresh snapshot when visible. Notifications keep that stream open. If many visible windows share an HTTP/1 origin, closing an extra window or using HTTP/2 on the HTTPS proxy can free connections.

## Known preview limits

See [history, reads, and resource budgets](architecture.md#rendering-and-resource-limits), [file preview formats](conversation-details.md#preview-documents-images-and-html), and [acceptance gates](acceptance.md#acceptance-gates) for supported behavior and verification scope.
