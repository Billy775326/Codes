# Codes documentation

Start with the [English quick start](../README.md) or [简体中文快速开始](README.zh-CN.md). Codes runs on one Linux host for one workspace owner.

## Use the workspace

| Goal                                                 | Guide                                                     |
| ---------------------------------------------------- | --------------------------------------------------------- |
| Register a directory and resume an existing chat     | [Projects and chats](conversations.md)                    |
| Send, queue, steer, branch, or answer Codex          | [Conversation workflow](conversation-workflow.md)         |
| Upload files and choose what Codex receives          | [Composer attachments](image-attachments.md)              |
| Preview files, read work history, or inspect changes | [Files, history, and changes](conversation-details.md)    |
| Choose model, effort, speed, or permissions          | [Codex execution configuration](conversation-settings.md) |

## Operate Codes

- [Configuration](configuration.md) maps the settings UI, startup environment, and persistence scopes.
- [Operations](operations.md) covers access, maintenance, backups, restore, and connection or task recovery.

## Develop and verify

- [Development](development.md) lists build commands, test fixtures, and the CLI compatibility checks.
- [Regression test cases](test-cases.md) lists fixtures, actions, and expected results by feature.
- [Architecture](architecture.md) explains process boundaries, task coordination, and resource limits.
- [Spec Coding](spec-coding.md) records execution ownership and invariants for changes.
- [Interface design](interface-design.md), [native conversation navigation](conversations.md), and [sidebar state](conversation-sidebar.md) document interaction and implementation contracts.
- [Acceptance](acceptance.md) lists verification gates and recorded evidence. [IDE alignment](ide-parity.md) describes the historical client audit and the supported interaction surface.
- [Roadmap](roadmap.md) and [open work](requirements.md) describe proposals and remaining verification.
- [Changelog](../CHANGELOG.md) and [brand](brand.md) cover user-visible changes and identity assets.
