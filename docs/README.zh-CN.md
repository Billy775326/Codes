# Codes 中文快速开始

Codes 是面向单用户的 Linux 自托管 Codex 网页工作台。可以在浏览器里管理项目与会话、审批操作、查看文件和代码变更。任务由 Linux 主机上的 Codex CLI 执行，关掉浏览器后，正在执行的任务会继续运行。

[English quick start](../README.md) · [完整文档索引](README.md)

## 安装并启动

准备 Linux、Node.js 24.19 或更新的 24.x 版本、npm 和浏览器。在运行 Codes 的 Linux 用户下安装 Codex CLI 并完成登录。[Codex CLI](https://learn.chatgpt.com/docs/codex/cli)

在 Codes 仓库内运行，替换示例中的项目目录：

```bash
npm ci
npm run build
CODES_PROJECT_ROOT=/absolute/path/to/project npm start
```

打开 [http://127.0.0.1:6670](http://127.0.0.1:6670)，用主机上 `.local/access-token` 中的令牌登录。更多目录可通过侧栏的「添加项目」登记。界面默认英文，在 **Settings → General → Appearance** 可切换为简体中文。

执行 `npm run install:command` 可安装 `codes` 前台启动命令。配置文件、环境变量和命令路径见[配置参考](configuration.md)。跨设备访问见[网络与访问](operations.md#network-and-access)。

## 使用工作台

- **项目和会话**。按本机目录管理已有 Codex 会话。支持搜索、归档和恢复。[项目与会话](conversations.md)
- **执行**。直接发送、排队，或把追问加入当前轮次。模型、速度和权限遵循当前项目的 Codex 有效配置。[会话操作](conversation-workflow.md) · [执行配置](conversation-settings.md)
- **文件**。从输入框的 `+` 上传，或者从 Files 引用项目文件。Word 支持正文预览，PDF 支持页面预览。[附件](image-attachments.md) · [文件与变更](conversation-details.md)
- **恢复**。断线后可重连。发送结果不明确时，先用「检查结果」核对原操作。服务重启后，待处理队列会保留并暂停。[运行与恢复](operations.md)

目前为开发预览。用 `CODES_RUNTIME=mock` 和独立数据目录可在不使用模型的情况下体验界面。真实任务、权限策略和部署的验收范围见[验收说明](acceptance.md)。项目理念和标识来源见[品牌说明](zh-CN/brand.md)。
