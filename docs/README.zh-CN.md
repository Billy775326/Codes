# Codes 中文快速开始

Codes 是面向单用户的 Linux 自托管 Codex 网页工作台。可以在浏览器里继续和管理 Codex 原生会话、审批操作、查看文件和代码变更。任务由 Linux 主机上的 Codex CLI 执行，关掉浏览器后，正在执行的任务会继续运行。

[English quick start](../README.md#quick-start) · [完整文档索引](README.md) · [参与开发](zh-CN/contributing.md)

<a id="安装并启动"></a>

## 快速开始

使用基于 glibc 的 Linux x86-64 或 ARM64 主机。请在运行 Codes 的 Linux 用户下安装 Codex CLI。[Codex CLI 安装文档](https://learn.chatgpt.com/docs/codex/cli)

### 安装 Codes

```bash
curl -fsSL https://raw.githubusercontent.com/Billy775326/Codes/v0.2.1/scripts/install.sh | bash
```

在终端选择界面语言和监听端口。安装器会显示工作区地址和新生成的访问令牌。安装包包含 Node.js，并将 `codes` 启动命令安装到 `~/.local/bin`。[安装和升级](operations.md#install-or-upgrade-a-release)

### 启动工作台

```bash
~/.local/bin/codes start
```

打开安装器显示的地址，默认是 [http://127.0.0.1:6670](http://127.0.0.1:6670)，然后输入工作区访问令牌。若 Codex 尚未登录，兼容的 CLI 可通过工作区里的「登录 Codex」进行设备码授权。侧栏可继续 Codex 原生会话，也可新建会话。[工作目录](conversations.md#working-directories) · [网络与访问](operations.md#network-and-access)

## 从源码运行

从源码运行需要 Node.js 24.19 或更新的 24.x 版本和 npm。在 Codes 仓库内运行以下命令。

```bash
npm ci
npm run build
npm start
```

执行 `npm run install:command` 可安装 `codes` 命令。直接运行 `codes` 可前台启动，`codes start` 用于后台启动。用 `codes help` 查看命令，`codes doctor` 诊断，`codes logs -f` 跟随后台日志。[配置文件、环境变量和命令路径](configuration.md)

## 使用工作台

- **会话**。查看所有工作目录中的 Codex 会话。支持搜索、归档和恢复。[项目与会话](conversations.md)
- **执行**。直接发送、排队，或把追问加入当前轮次。模型、速度和权限遵循该会话工作目录的 Codex 有效配置。[会话操作](conversation-workflow.md) · [执行配置](conversation-settings.md)
- **文件**。从输入框的 `+` 上传，或者从 Files 引用项目文件。Word 支持正文预览，PDF 支持页面预览。[附件](image-attachments.md) · [文件与变更](conversation-details.md)
- **恢复**。断线后可重连。发送结果不明确时，先用「检查结果」核对原操作。服务重启后，待处理队列会保留并暂停。[运行与恢复](operations.md)

目前为开发预览。用 `CODES_RUNTIME=mock` 和独立数据目录可在不使用模型的情况下体验界面。各功能的操作步骤和预期结果见[回归测试用例](test-cases.md)，真实任务、权限策略和部署的验收范围见[验收说明](acceptance.md)。

## 致谢

感谢以下项目的维护者和贡献者。

- **Codex CLI** 通过 App Server 提供原生会话和任务执行能力。[openai/codex](https://github.com/openai/codex)
- **Covro** 为自托管 Codex 工作台和设置界面提供设计参考。[yuzheng14/covro](https://github.com/yuzheng14/covro)
- **1Panel** 为设置分类和快速安装流程提供设计参考。[1Panel-dev/1Panel](https://github.com/1Panel-dev/1Panel)

[第三方组件与许可证](../LICENSES/THIRD-PARTY.md) · [品牌与字体来源](zh-CN/brand.md)
