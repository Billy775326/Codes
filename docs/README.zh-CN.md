# Codes 中文快速开始

Codes 是面向单用户的 Linux 自托管 Codex 网页工作台。可以在浏览器里继续和管理 Codex 原生会话、审批操作、查看文件和代码变更。任务由 Linux 主机上的 Codex CLI 执行，关掉浏览器后，正在执行的任务会继续运行。

[English quick start](../README.md) · [完整文档索引](README.md)

## 安装并启动

在使用 glibc 的 Linux x86-64 或 ARM64 上运行一键安装命令。

```bash
curl -fsSL https://raw.githubusercontent.com/Billy775326/Codes/v0.1.0/scripts/install.sh | bash
```

安装包包含 Node.js。在运行 Codes 的 Linux 用户下安装 Codex CLI 并完成登录，然后执行 `~/.local/bin/codes start`。[Codex CLI](https://learn.chatgpt.com/docs/codex/cli) · [安装和升级](operations.md#install-or-upgrade-a-release)

从源码运行需要 Node.js 24.19 或更新的 24.x 版本和 npm。在 Codes 仓库内运行以下命令。

```bash
npm ci
npm run build
npm start
```

打开 [http://127.0.0.1:6670](http://127.0.0.1:6670)，使用首次启动时提示的令牌文件登录。侧栏会列出原生会话。新建会话时可以选择工作目录。界面默认英文，在 **Settings → General → Appearance** 可切换为简体中文。

执行 `npm run install:command` 可安装 `codes` 命令。直接运行 `codes` 可前台启动，`codes start` 用于后台启动。用 `codes help` 查看命令，`codes doctor` 诊断，`codes logs -f` 跟随后台日志。配置文件、环境变量和命令路径见[配置参考](configuration.md)。跨设备访问见[网络与访问](operations.md#network-and-access)。

## 使用工作台

- **会话**。查看所有工作目录中的 Codex 会话。支持搜索、归档和恢复。[项目与会话](conversations.md)
- **执行**。直接发送、排队，或把追问加入当前轮次。模型、速度和权限遵循该会话工作目录的 Codex 有效配置。[会话操作](conversation-workflow.md) · [执行配置](conversation-settings.md)
- **文件**。从输入框的 `+` 上传，或者从 Files 引用项目文件。Word 支持正文预览，PDF 支持页面预览。[附件](image-attachments.md) · [文件与变更](conversation-details.md)
- **恢复**。断线后可重连。发送结果不明确时，先用「检查结果」核对原操作。服务重启后，待处理队列会保留并暂停。[运行与恢复](operations.md)

目前为开发预览。用 `CODES_RUNTIME=mock` 和独立数据目录可在不使用模型的情况下体验界面。各功能的操作步骤和预期结果见[回归测试用例](test-cases.md)，真实任务、权限策略和部署的验收范围见[验收说明](acceptance.md)。项目理念和标识来源见[品牌说明](zh-CN/brand.md)。
