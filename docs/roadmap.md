# Development milestones

The first implementation establishes a working preview across the initial milestones. Integration scaffolding and simulator verification are separate from live acceptance.

| Milestone                     | Implemented                                                                                                                           | Remaining acceptance                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| M0 — protocol bridge          | Pinned CLI process, JSONL framing, request deadlines, create/resume/send/interrupt, native history reads, explicit simulator          | Broader real tool/output coverage; basic live read/write/interrupt passed           |
| M1 — recovery                 | Durable operation UUIDs, per-thread execution lease, epoch-scoped approvals, unknown outcomes, explicit native-history reconciliation | Service restart reconciliation and real prompting permission-policy cases           |
| M2 — desktop workspace        | Projects, conversations, draft retention, file/selection context, streaming text/tool activity, current-turn read-only diff           | Large real repositories and real tool-output rendering                              |
| M3 — remote use               | Responsive phone approvals, token sessions, same-origin checks, loopback default, process lock and shutdown, operations guide         | Intended HTTPS proxy, service supervisor, actual phone and backup/restore           |
| M4 — pilot and release review | Automated simulator/browser gates, metadata smoke, and a basic live read/write/interrupt pilot                                        | Real prompting-policy pilot, target deployment measurements, owner release decision |

## Next priorities

1. Extend the completed basic live read/write/interrupt pilot to real prompting policies, service restarts, and the intended deployment environment.
2. Improve navigation for exceptionally large tool outputs and long conversations while retaining fixed memory limits.
3. Add a reviewed service-supervisor example after the target runtime path and account setup are known.
4. Add a broader CLI compatibility matrix only when each version has contract and live evidence.

See [remaining implementation and acceptance](requirements.md) for prioritized feature gaps and separate verification gates. Existing functions awaiting real acceptance should not be presented as missing implementations.

Multi-user accounts, browser terminals, automatic publishing, package releases, and automatic Git operations are outside the initial scope. Do not add them to solve unrelated performance issues.

The package uses an internal `0.0.0` marker during initial development. It is not a released compatibility promise. Normal development commits do not create a version, tag, release, or deployment.
