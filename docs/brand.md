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

## Logo

<img src="../public/brand/codes-mark.png" width="128" height="128" alt="codes C/S monogram" />

The outer **C** forms an open workspace frame. The inner **S** suggests a conversation flowing into the next action. Rounded strokes and open space keep the mark simple at small sizes. Muted sage green supports the quiet dark and light interfaces. The wordmark remains lowercase **codes**, using the application's existing system font.

The shared brand component displays the mark with the name. The design phrase belongs in documentation, while the working interface stays focused on tasks.

| Asset                                       | Purpose                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| [Source PNG](brand/codes-mark-source.png)   | Original high-resolution transparent image generated for this identity |
| [Web mark](../public/brand/codes-mark.png)  | 256 × 256 transparent PNG for the README, sign-in and sidebar          |
| [Browser icon](../public/brand/favicon.png) | 64 × 64 transparent PNG for browser tabs                               |

Keep the aspect ratio and transparent background. Use the supplied green mark on a quiet neutral surface, retain its existing clear space, and avoid stretching, shadows, or decorative effects. The interface uses a 32px image at sign-in and a 28px image in navigation. Browser tabs render the dedicated icon at their own size.

The high-resolution source is retained in documentation rather than shipped with the application. Vite copies the small `public/brand` assets into the build. To regenerate the web copies after changing the source, use Node 24 and the existing Playwright browser installation:

```bash
npm run brand:export
```

Set `CODES_CHROME=/path/to/chrome` when using a system Chrome instead of Playwright Chromium. Exporting only resizes and encodes the source, preserves transparency, and makes no network or model requests.
