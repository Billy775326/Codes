# Remaining implementation and acceptance

codes has a working single-owner preview. Conversations, streaming, approvals/questions, file selections, current-turn diffs, token sign-in, and bounded browser recovery are implemented. Basic live reading, editing, native history, and interruption have passed an isolated pilot.

This document separates proposed implementation work from acceptance of existing behavior. Priorities are recommendations based on the current source and documented limits; they are not completed features or a commitment to implement the entire list in the current task.

## Implementation priorities

| ID  | Priority | Work remaining                                     | Current limitation and completion criterion                                                                                                                                                                                                                                         |
| --- | -------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | P0       | Extend unknown-result recovery and its diagnostics | Reconciliation currently scans the latest 12 turns. Locate an operation by its known turn/client identity beyond that window, explain why it is still locked, and offer a safe next action. Never clear an unknown execution merely to enable another send.                         |
| R2  | P0       | Scale history, tool output, and file previews      | The browser stops older-history loading at 240 displayed messages, output is clipped, and file lines are all rendered. Add navigable bounded windows or virtualization, explicit truncation notices, and paginated directory entries. Validate responsiveness on the intended host. |
| R3  | P1       | Package service supervision and health checks      | The current trial is a manually started process. Provide a reviewed service template, explicit runtime/account configuration, bounded restart behavior, and a readiness check. A restart must preserve unknown outcomes and never resend work.                                      |
| R4  | P1       | Complete conversation navigation and management    | Add conversation search, rename/archive controls, and discovery beyond the latest 30 native conversations and 200 local summaries. Preserve native history as the source of truth.                                                                                                  |
| R5  | P1       | Complete project registration management           | The UI currently adds/selects directories. Add registration rename/removal and clear handling of missing/moved paths. Removing a registration must not delete its directory or native conversations.                                                                                |
| R6  | P1       | Expose useful runtime diagnostics                  | The API reports basic runtime state/version, but the UI lacks a dedicated status view. Show actionable CLI availability/version/authentication and connection errors without exposing credentials or raw sensitive logs.                                                            |

R1 and R2 are the recommended next engineering steps because recovery and responsiveness are the main reasons for this project. The current limits already bound many resources; extending them must retain those bounds.

## Existing behavior still requiring acceptance

These are verification gates, not a request to rewrite the implemented features.

| ID  | Priority | Gate                                   | Evidence still needed                                                                                                                                                                                                                    |
| --- | -------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | P0       | Real prompting approvals and questions | A host policy that actually emits command, file, and turn-scoped permission requests; accept/decline, structured questions, expired callbacks, and competing clients. The previous harmless live command was allowed without a callback. |
| V2  | P0       | Service restart during execution       | Real graceful and unexpected exits, pending approval expiry, native-history correlation after restart, and proof that a reconnect never duplicates execution. Simulator/runtime-loss coverage is not equivalent to this pilot.           |
| V3  | P0       | Intended HTTPS and physical phone      | The owner's actual proxy/origin, Secure cookies, unbuffered SSE, mobile background/foreground transitions, and approval from a physical phone. Responsive browser emulation has passed.                                                  |
| V4  | P0       | Backup and restore                     | Restore codes metadata together with the required native Codex history under the intended service account. Preserve permissions and unresolved operation receipts. A procedure is documented; end-to-end restore is unverified.          |
| V5  | P1       | Representative scale and long sessions | Measure switching, scrolling, input latency, memory, and stream recovery with real repositories and large tool outputs. The synthetic browser threshold is not a production benchmark.                                                   |

## Optional follow-ups

- Token rotation and session-management controls; the current method is private configuration plus service restart.
- Reasoning-effort and model-settings controls, after their supported protocol fields are verified for the pinned CLI.
- Conversation export and small conveniences such as code-block copy buttons.
- Additional CLI-version compatibility only after contract and live checks exist for each version.

Multi-user accounts, a browser terminal, an editable IDE, and automatic Git publishing/deployment remain outside the initial scope. They are not required to finish the current single-owner workspace.

## Login scope completed in this change

The login screen uses a two-column desktop layout and a single-column mobile layout, with clearer form hierarchy, masked token visibility controls, token-location help, busy/error states, and retry after an initial connection failure. It continues to use the existing token/session API; it does not add a second account system or browser-side Codex credential storage.

See [milestones](roadmap.md) for stage boundaries, [acceptance](acceptance.md) for test evidence, and [operations](operations.md) for current deployment/recovery procedures.
