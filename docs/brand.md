# codes: philosophy and identity

**codex no cli = codes**

codes brings Codex into a self-hosted browser workspace. Everyday work should flow through conversations, planning, approvals, queues, and change review without requiring the user to operate a terminal. The phrase expresses the product experience: Codex CLI and its App Server still execute the work.

[中文说明](zh-CN/brand.md)

## Design principles

- **One clear workflow.** Group project selection, conversation management, task input, and change review by purpose. Use layout and explicit state before adding explanatory copy.
- **Native execution.** Preserve Codex task, permission, approval, and planning behavior through structured App Server messages.
- **Simple parts.** Reuse components and state sources. Keep presentation, execution, subscriptions, receipts, and storage responsibilities clear.
- **Trustworthy state.** Distinguish task progress, required responses, queue conditions, and connection health. An uncertain receipt needs reconciliation before another send.
- **Clear operations for people and agents.** Retain semantic names, keyboard access, selected state, recoverable errors, and bounded data loading.

These principles guide implementation choices; they do not promise that every Codex surface feature is already available in codes. The README and acceptance documents track actual support.

## Identity status

The previous C/S logo has been withdrawn. The interface uses its earlier temporary mark while new directions await the project owner's selection. Candidate designs are review material, not an approved identity, and are not applied to the interface before that selection.
