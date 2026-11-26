# Development roadmap

Codes provides a single-owner local preview. Use [Open work](requirements.md) for proposed implementation and [Acceptance](acceptance.md) for outstanding verification.

| Track         | Available today                                                                                 | Next validation or work                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Native bridge | Capability detection, structured execution, review, interruption, and history                   | Representative live runtimes and larger native outputs                                       |
| Recovery      | Durable receipts, queue pause/recovery, and exact native correlation                            | Known operation lookup beyond the recent reconciliation window and measured restart recovery |
| Workspace     | Project navigation, saved drafts, attachments, file previews, changes, and phone layout         | Scale against representative projects and large turns                                        |
| Hosting       | Loopback, token sessions, private HTTPS and Cloudflare Access configuration, backup and staging | Validate intended supervisor, proxy, phone, and full restore together                        |
| Verification  | Simulator, browser, native metadata matrix, and isolated model pilots                           | Real prompting policies and a release review                                                 |

## Next priorities

1. Verify actual requested approvals and questions, native restart recovery, and deployment backup and restore under the intended account.
2. Improve finding unresolved receipts and navigating large individual turns while preserving resource bounds.
3. Document a reviewed supervisor example once the target account and process paths are known.
4. Extend the compatibility matrix with contract evidence for each added CLI version.

The internal package marker is `0.0.0`. The owner authorizes formal release and new deployments separately. [Release and maintenance workflow](operations.md#updating-the-owners-local-preview)
