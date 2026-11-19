# Remaining implementation and acceptance

codes has a working single-owner preview. Searchable conversation navigation, native rename/archive/restore, streaming, approvals/questions, file selections, current-turn diffs, token sign-in, and bounded browser recovery are implemented. Basic live reading, editing, native history, and interruption have passed an isolated pilot.

This document separates proposed implementation work from acceptance of existing behavior. Priorities are recommendations based on the current source and documented limits; they are not completed features or a commitment to implement the entire list in the current task.

## Implementation priorities

| ID  | Priority | Work remaining                                     | Current limitation and completion criterion                                                                                                                                                                                                                                                                                                                         |
| --- | -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | P0       | Extend unknown-result recovery and its diagnostics | Reconciliation currently scans the latest 12 turns. Locate an operation by its known turn/client identity beyond that window, explain why it is still locked, and offer a safe next action. Never clear an unknown execution merely to enable another send.                                                                                                         |
| R2  | P0       | Scale history, tool output, and file previews      | Bidirectional history already uses three bounded native pages plus a separate live cache; 240 items / 2 MiB is a per-page budget, not the end of accessible history. Tool/patch truncation notices and patch windows exist. Improve very large single-turn navigation, file virtualization, and directory pagination. Validate responsiveness on the intended host. |
| R3  | P1       | Package service supervision and health checks      | The current trial is a manually started process. Provide a reviewed service template, explicit runtime/account configuration, bounded restart behavior, and a readiness check. A restart must preserve unknown outcomes and never resend work.                                                                                                                      |
| R5  | P1       | Complete project registration management           | The UI still adds/selects directories. The conversation-first proposal replaces visible registration management with per-conversation directory context; that change is not implemented. First fix directory ownership and missing/moved-path behavior. Retain existing registrations and native history; see the navigation audit.                                 |
| R6  | P1       | Expose useful runtime diagnostics                  | The API reports basic runtime state/version, but the UI lacks a dedicated status view. A session status view now shows connection, runtime/version, model/effort, permissions and native token usage. Authentication-specific remediation and richer safe error diagnostics remain.                                                                                 |

**R4 conversation management and in-conversation workflows are implemented.** The sidebar supports case-insensitive title search, native cursor pagination, rename, archive/restore, protected active/unknown tasks, retained drafts, structured question controls, quoted follow-ups, durable FIFO queues, and native per-turn branching. Search scans a bounded portion at a time; permanent deletion, full-text search, and export remain outside this change. See [conversation management](conversations.md) and [acceptance](acceptance.md) for scope and evidence.

R1 and R2 remain the recommended next engineering steps because recovery and responsiveness are the main reasons for this project. The current limits already bound many resources; extending them must retain those bounds.

See the [conversation-first navigation audit](session-navigation-proposal.md) for verified baseline gaps and proposed acceptance gates. Removing the project selector alone does not meet them.

## Existing behavior still requiring acceptance

These are verification gates, not a request to rewrite the implemented features.

| ID  | Priority | Gate                                   | Evidence still needed                                                                                                                                                                                                                                                                                                       |
| --- | -------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | P0       | Real prompting approvals and questions | A host policy that actually emits command, file, and turn-scoped permission requests; real Auto-review decisions/quota/account availability and long-session compaction; accept/decline, structured questions, expired callbacks, and competing clients. The previous harmless live command was allowed without a callback. |
| V2  | P0       | Service restart during execution       | Real graceful and unexpected exits, pending approval expiry, native-history correlation after restart, and proof that a reconnect never duplicates execution. Simulator/runtime-loss coverage is not equivalent to this pilot.                                                                                              |
| V3  | P0       | Intended HTTPS and physical phone      | The owner's actual proxy/origin, Secure cookies, unbuffered SSE, mobile background/foreground transitions, and approval from a physical phone. Responsive browser emulation has passed.                                                                                                                                     |
| V4  | P0       | Backup and restore                     | Restore codes metadata together with the required native Codex history under the intended service account. Preserve permissions and unresolved operation receipts. A procedure is documented; end-to-end restore is unverified.                                                                                             |
| V5  | P1       | Representative scale and long sessions | Measure switching, scrolling, input latency, memory, and stream recovery with real repositories and large tool outputs. The synthetic browser threshold is not a production benchmark.                                                                                                                                      |

Local IDE workflow changes and remaining differences are tracked in the [alignment audit](ide-parity.md). VS Code host integration and Codex Cloud are excluded.

## Optional follow-ups

- Token rotation and session-management controls; the current method is private configuration plus service restart.
- Conversation export and small conveniences such as code-block copy buttons.
- Additional CLI-version compatibility only after contract and live checks exist for each version.

Multi-user accounts, a browser terminal, an editable IDE, and automatic Git publishing/deployment remain outside the initial scope. They are not required to finish the current single-owner workspace.

## Login scope completed in this change

The login screen uses a two-column desktop layout and a single-column mobile layout, with clearer form hierarchy, masked token visibility controls, token-location help, busy/error states, and retry after an initial connection failure. It continues to use the existing token/session API; it does not add a second account system or browser-side Codex credential storage.

See [milestones](roadmap.md) for stage boundaries, [acceptance](acceptance.md) for test evidence, and [operations](operations.md) for current deployment/recovery procedures.
