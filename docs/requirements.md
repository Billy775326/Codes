# Open work and acceptance gates

This page tracks proposed implementation and evidence still needed for the single-owner preview. User guides describe implemented behavior, and the [roadmap](roadmap.md) sets priorities.

## Implementation priorities

| ID  | Proposed work                                   | Completion criterion                                                                                                                               |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Extend unknown-result reconciliation            | Find a known operation beyond the recent native history window. Show why it remains protected and verify that recovery never duplicates execution. |
| R2  | Improve large-turn and large-project navigation | Measure representative history load, file navigation, and editor responsiveness. Preserve bounded memory and cancellable reads.                    |
| R3  | Document service supervision                    | Validate a reviewed example with the intended service user, working directory, environment, ready check, and bounded restart behavior.             |
| R6  | Add targeted runtime diagnostics                | Use the existing status and diagnostics surfaces to explain authentication and runtime failures with safe, actionable details.                     |

R4 conversation management and R5 directory ownership are implemented. Use [Projects and chats](conversations.md) and [Navigation ownership](session-navigation-proposal.md) for those contracts, including bounded search, project archiving, and missing-directory handling.

## Existing behavior still requiring acceptance

| ID  | Gate                     | Evidence needed                                                                                                                                                                                                     |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | Native interactions      | A real prompting policy that emits command, file, permission, and structured question requests. Exercise responses, expiry, and concurrent clients. Check actual Auto-review decisions and long-session compaction. |
| V2  | Restart with active work | Graceful and unexpected restarts, matching terminal history, expired interactions, and no duplicate execution                                                                                                       |
| V3  | Actual remote path       | HTTPS origin and cookies, unbuffered events, physical phone, and background/foreground transitions                                                                                                                  |
| V4  | Full restore             | Codes database, native histories, necessary files and credentials, with preserved permissions and protected receipts                                                                                                |
| V5  | Representative scale     | Observe CPU, memory, latency, and recovery with native repositories and large tool results                                                                                                                          |

See the [acceptance guide](acceptance.md#live-pilot-checklist) for fixture and recording requirements.

## Optional follow-ups

Conversation export and wider search are candidates for future design. Multi-user tenancy, a browser terminal, and automated Git publishing are beyond the current single-owner scope.

<a id="login-scope-completed-in-this-change"></a>

## Login and session controls

The workspace uses a branded token form, with a persistent server-side token policy and browser session controls. Token rotation and login lifetime are available under [Network & access](operations.md#network-and-access). Physical-phone and HTTPS acceptance remain part of V3.
