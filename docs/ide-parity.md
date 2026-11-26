# Codex IDE interaction alignment

This audit records the client behavior that informed Codes. The supported workflow runs in a self-hosted browser over Codex App Server. Use the [interface design](interface-design.md) for the current workspace layout and the [acceptance guide](acceptance.md) for verification.

## Evidence baseline

The audit inspected the Linux x64 Marketplace package `openai.chatgpt` **26.1111.21308** on 2026-11-18. It reviewed the published manifest and selected package assets without installing the extension. Codes uses its own browser components and the native App Server interface. [Extension manifest](https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.1111.21308/1794532470202/Microsoft.VisualStudio.Code.Manifest) · [Published package](https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.1111.21308/1794532470202/Microsoft.VisualStudio.Services.VSIXPackage)

| Inspected artifact                                             | SHA-256                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Extension manifest                                             | `0ae058c9b1d155e362805d4310dabc65c2fc86bbb6151b003177b1cfaaa20108` |
| `out/extension.js`                                             | `aa93a1b5aaa79746f3b583133355c659a0f059ff98d1956adf9da0e4afbcf817` |
| `webview/assets/request-user-input-panel-de325f1727cf.js`      | `9be4707a7a3d1baf1f6d8d760b1b08157f614119130ecc2d418873118bdbca77` |
| `webview/assets/local-conversation-thread-b3241503ccfa.js`     | `17db24bf63760bbd4f244eb3cf50e221c8c1e99cc580f1db5ea6824b5216c2d4` |
| `webview/assets/thread-side-panel-tab-content-40cb0f8a4ff2.js` | `b2810642628723b25847c3188d7b7507206445a07d53fe74bb018d396252ab37` |

The audit identified delivery mode and Enter preferences, choice and custom answer handling, and patch inspection. App Server features used by Codes are checked against the installed generated protocol. [IDE settings](https://learn.chatgpt.com/docs/ide/settings) · [App Server](https://learn.chatgpt.com/docs/app-server)

## Web workspace layout

### Panel layout reference

The 2026-11-18 review used the official IDE image to inspect interaction structure. Codes organizes its browser layout around project navigation, conversation, and a right-side file or change preview. [IDE review image](https://learn.chatgpt.com/images/codex/ide-review.webp)

## Implemented local contracts

| Interaction             | Codes behavior                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Conversations           | Native listing, title search, rename, archive, and restore. Drafts belong to the current browser.                        |
| Questions and approvals | Show native interactions in their originating turns with explicit answers, approval choices, and recovery states.        |
| Follow-ups              | Use native steering during an eligible turn or queue a later turn. The browser preference selects the default.           |
| Execution               | Show effective model, effort, speed, and permissions. Plan and Execution use the native settings and task mode.          |
| Code review             | Review uncommitted changes, a branch, a commit, or custom instructions, inline or in a separate conversation.            |
| Files and patches       | Attach selected text, images, or references. Preview supported files and selected native patches with bounded rendering. |
| Status                  | Show connection, CLI version, reported usage, and native activity when available.                                        |

The local command list includes `/model`, `/reasoning`, `/plan`, `/review` when supported, `/status`, `/approve`, `/fork`, and `/ide-context`. The last command opens Codes file browsing. Use Ctrl/Cmd+N in the page to start a draft where the browser permits it. [Conversation workflow](conversation-workflow.md)

## Recovery and compatibility

Sends and reviews share a durable execution lease. Steering has separate receipts and uses the running turn. The historical 0.167.0 pilot found an inner runner start paired with an outer review completion. Codes reconciles the acknowledged review identity and retains bounded terminal event evidence for ordering races.

Current metadata uses schema 6. The installed CLI determines available native capabilities. [Architecture](architecture.md#compatibility-and-trust) · [Migration](conversations.md#metadata-migration-and-rollback)

## Remaining local differences

Codes focuses on local Linux workflows. VS Code buffer selection, CodeLens, terminal and language-server integration, editor settings synchronization, and Codex Cloud delegation remain outside that scope. Broader history reconciliation and performance work are tracked in [Open work](requirements.md).

## Verification boundaries

Simulator browser tests cover the Web interaction and adapter recovery. Native metadata smoke checks the actual protocol without using a model. The historical IDE pilot used a real account in a disposable project. The [acceptance record](acceptance.md#local-ide-interaction-acceptance) gives the scope and results of each.
