# 参与 Codes 开发

[English contributor guide](../../CONTRIBUTING.md)

Codes 是 Codex CLI 的自托管网页工作台。第一次贡献可以先用模拟环境跑通界面，再按功能找到对应的源码和测试。

## 启动开发环境

在 Linux 上准备 npm 和 Node.js 24.19.0 或更新的 24.x 版本，从仓库根目录运行以下命令。模拟环境无需登录 Codex，也不会发起模型请求。

```bash
npm ci
codes_dev_data=$(mktemp -d)
CODES_RUNTIME=mock CODES_DATA_DIR="$codes_dev_data" CODES_HOST=127.0.0.1 CODES_PORT=6671 npm run dev
```

打开 [http://127.0.0.1:6671](http://127.0.0.1:6671)，使用终端提示的令牌文件登录。若端口已占用，换一个空闲端口。发送 `[question]` 可以体验结构化提问，发送 `[hold]` 可以在任务运行时测试排队和停止。结束时在终端按 Ctrl+C。[开发与测试](../development.md)

## 从哪里读代码

浏览器通过 HTTP 提交操作，通过 SSE 接收更新。Codes 的 Node.js 服务使用 JSONL 与 Codex App Server 通信。Codex 管理原生会话、工作目录、执行和有效配置。Codes 管理网页登录、草稿、队列和操作回执。[架构](../architecture.md) · [执行约定](../spec-coding.md)

| 功能                     | 源码入口                                                                                                                                    | 对应测试                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 会话侧栏                 | [Conversations.tsx](../../src/web/Conversations.tsx)                                                                                        | [conversations.spec.ts](../../tests/browser/conversations.spec.ts)       |
| 发送、排队和加入当前任务 | [useMessageDelivery.ts](../../src/web/useMessageDelivery.ts)、[service.ts](../../src/server/service.ts)                                     | [delivery.spec.ts](../../tests/browser/delivery.spec.ts)                 |
| 历史分页和重连           | [useConversationTimeline.ts](../../src/web/useConversationTimeline.ts)、[conversation-history.ts](../../src/server/conversation-history.ts) | [history.spec.ts](../../tests/browser/history.spec.ts)                   |
| 文件和变更               | [FilesPanel.tsx](../../src/web/FilesPanel.tsx)、[DiffView.tsx](../../src/web/DiffView.tsx)                                                  | [details.spec.ts](../../tests/browser/details.spec.ts)                   |
| Codex 协议和配置         | [protocol.ts](../../src/codex/protocol.ts)、[native-configuration.ts](../../src/server/native-configuration.ts)                             | [native-configuration.test.ts](../../tests/native-configuration.test.ts) |
| 启动器和安装脚本         | [codes.mjs](../../bin/codes.mjs)、[install.sh](../../scripts/install.sh)                                                                    | [smoke-install.sh](../../scripts/smoke-install.sh)                       |

## 验证和提交

从 `main` 创建任务分支，先复现，再运行对应测试。以 Changes 面板为例。

```bash
npm run check
npx playwright install chromium
npm run test:e2e -- tests/browser/details.spec.ts
```

提交功能改动前，运行 `npm run format:check`、`npm run check`、`npm test` 和 `npm run test:e2e`。涉及 App Server 协议时，用 `npm run test:native` 核对兼容性。提交信息使用英文，面向用户的变化记入 [Unreleased](../../CHANGELOG.md#unreleased)。在 PR 中说明复现条件、改动和实际验证结果。截图和测试使用模拟数据。[开发检查](../development.md#checks) · [项目规范](../../AGENTS.md)
