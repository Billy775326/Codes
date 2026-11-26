# Acceptance and verification

Codes targets one workspace owner on a Linux host. This guide distinguishes simulator coverage, native metadata compatibility, isolated model pilots, and acceptance of a specific deployment.

## Acceptance gates

| Area                           | Evidence available                                                                                                   | Additional acceptance                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Dispatch, receipts, and queues | Service and simulator fault-injection tests cover duplicate IDs, cancellation, stale input, and reconnect            | Real recovery during service restart and a run using representative native outputs           |
| Workspace and phone layout     | Simulator browser tests cover narrow widths, keyboard focus, multiple browser sessions, approvals and questions      | Physical phone, real proxy, and background/foreground behavior                               |
| Directory ownership and files  | Service and browser tests cover project lookup, missing directories, stale selections, previews, and file references | Representative filesystem permissions and repository scale                                   |
| Native execution               | Isolated CLI 0.167.0 read/write, review, steering, branching, and interruption pilots                                | Real prompting policy, file and permission approvals, questions, and long-session compaction |
| Compatibility                  | CI native metadata smoke across the versions listed in [Development](development.md#checks)                          | Feature-specific live acceptance for the intended runtime                                    |
| Operations                     | Token, backup staging and restore, settings, and transport regressions                                               | A coordinated Codes and native-history restore under the intended service account            |

## Local evidence

Run the commands in [Development](development.md#checks) for the current checkout. Use the [regression test cases](test-cases.md) to select scenarios and verify feature coverage. Historical counts below belong to their individual runs. Simulator tests use temporary data and exercise the browser and server without using a real model account.

### 2026-11-26 workspace acceptance

The working tree based on `569082f` built with Node.js 24.22.3. TypeScript and formatting checks passed for project files. The broad formatter was stopped after scanning locally excluded migrated projects and reporting existing formatting in the local `AGENTS.md`.

- **Unit and integration** passed 262 tests in 27 files on the complete rerun. The first run reported three CLI initialization timeouts.
- **Simulator browser** covered 214 tests with Chromium 151. The initial run passed 209. Two conversation-load timeouts and three launcher cases missing copied fixtures passed in a separate rerun of the five failures.
- **Native metadata** passed for Codex CLI 0.166.0, 0.167.0, 0.168.0, and 0.172.0. Checks exercised configuration layering and conflicts, capabilities, native working directories, history, and archive and restore.
- **Local preview** at port 6670 served the same web entry as the candidate and reported CLI 0.172.0. An isolated browser verified sign-in, desktop settings, all three backup sections, browser preference export, a 320 px layout, and the working-directory chooser.
- **Web update** passed an isolated install, retained-asset check, rollback, and rejection of mismatched backend output.

Real model execution, physical-phone and external-proxy behavior, representative scale measurement, and coordinated restoration of Codes and native data remain separate acceptance gates.

The document preview change at `dc327e4` passed CI, focused HTTP and browser checks, a legacy DOC sample, and a Chrome PDF rendering check. The existing 6670 preview also passed a browser check after its update with CLI 0.172.0 and schema 6. Those checks are about preview and runtime readiness. [CI run](https://github.com/Billy775326/Codes/actions/runs/45742529992)

## Live pilot checklist

Use a disposable Git project and the intended Linux account. Authorize model use before starting the opt-in [live commands](development.md#real-codex-pilots).

1. Explain a known file in Read only mode and compare the final answer and native history after reload.
2. Start a harmless long task, reconnect, and Stop. Verify the terminal event and the original task identity.
3. Under an explicit Workspace write policy, request a fixture-only edit and compare the reported patch to disk.
4. Exercise an actual prompting policy. Resolve one approval from a physical phone, then test decline, required and optional questions, and expired requests.
5. Test graceful and unexpected restarts with active work. Confirm uncertain outcomes remain tied to the original receipt.
6. Confirm the intended HTTPS origin, cookies, unbuffered events, token rotation, and a coordinated restore.

Record the commit, CLI version, policy, browser or device, fixture, and outcome. Include failures and checks still pending.

## Live pilot evidence

The CLI 0.167.0 pilot used a disposable fixture and a real model account. It streamed native reads, verified user message identity in history, wrote the fixture under Workspace write, and confirmed interruption by native terminal evidence. Its approval probe completed with zero approval callbacks. A host policy that actually prompts is still needed.

The separate IDE pilot exercised Plan and its return to Code, model reasoning metadata, same-turn steering, reported usage, and a read-only native review. It passed after the service learned to correlate the acknowledged outer review ID when an inner runner starts first.

## Historical regression evidence

The following records summarize earlier completed checks. Counts reflect the code and fixtures at each milestone. [Earlier detailed record](https://github.com/Billy775326/Codes/blob/dc327e453425e74eff529aba1aab04af4f0505ae/docs/acceptance.md)

### Conversation management acceptance

The 2026-11-17 baseline passed 37 unit/integration and 13 simulator browser checks. The conversation management milestone recorded 45 unit/integration and 18 browser checks. A separate CLI 0.167.0 live pilot exercised rename, archive, restore, history retention, and a model turn after restoring.

### In-conversation workflow acceptance

The 2026-11-18 milestone recorded 60 unit/integration and 22 browser checks for FIFO delivery, protected receipts, question forms, quoted drafts, and native branching. Its CLI 0.167.0 pilot preserved the source history and project files through a fork and ran two queued turns.

### Local IDE interaction acceptance

On 2026-11-18, the isolated real IDE pilot covered Plan, Code, steering, usage, and native review. The corresponding local suite recorded 76 unit/integration and 34 simulator browser checks. A delayed acknowledgement regression protects newer composer edits.

### Clarification and patch-preview details

This milestone recorded 86 unit/integration and 41 browser checks, including optional questions, stale callbacks, patch budgets, and bounded row windows. A CLI 0.167.0 metadata check exercised Code-mode input configuration. These checks are scoped to the interfaces and fixtures read by the test.

### IDE panel layout acceptance

The 2026-11-18 panel milestone recorded 86 unit/integration and 48 browser checks, including desktop and narrow widths, popover focus, theme persistence, and Stop. Synthetic screenshots were compared with the [panel layout reference](ide-parity.md#panel-layout-reference).

### Web workspace navigation acceptance

The 2026-11-18 navigation milestone recorded 86 unit/integration and 52 browser checks. Added cases covered project drafts, cancelled stale file reads, focus restoration, and mobile attachment return.

### Native Auto-review and context-compaction acceptance

The CLI 0.167.0 metadata smoke exercised native reviewer configuration. The 2026-11-19 local record covered 177 distinct unit/integration scenarios across the full run and targeted follow-up, plus 139 browser scenarios across sequential batches and focused reruns. A reboot interrupted one batch and an image-preview check timed out once before its focused reruns passed. These were simulator and metadata checks for the affected flows.

### Project and conversation context acceptance

On 2026-11-19, one complete local run passed 185 unit/integration and 145 browser scenarios. A later focused pass covered directory and queue refinements. CLI 0.167.0 metadata smoke verified directory working context and missing-directory recovery. [Navigation design](session-navigation-proposal.md)

### Imported legacy history acceptance

On 2026-11-19, 189 unit/integration and 145 browser cases passed after bounded legacy turn paging was added. A separate CLI 0.167.0 read-only check covered selected legacy, empty archived, and paginated histories using isolated Codes metadata. It submitted no model task.
