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

## Identity assets

The project owner supplied the approved V3 identity in `codes-logo-v3`. The sidebar and login use its original outlined **Codes** wordmark; the browser favicon uses its standalone icon. Light and dark SVG variants are selected by the workspace theme, with no external font request or regenerated artwork.

Production assets are `public/brand/codes-lockup-dark.svg`, `codes-lockup-light.svg`, and `codes-icon.svg`. They are copied into each build; the source is the owner-provided V3 package, not an earlier candidate gallery. Keep these originals unchanged. The outlined wordmark derives from Inter; its font license is preserved in `LICENSES/OFL-Inter.txt`. This attribution does not assign a license to the application's source code. Earlier candidate galleries are review archives, not the current identity.
