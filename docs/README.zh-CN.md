# codes 中文说明

codes 是面向单用户的 Linux 自托管 Codex 网页工作台，电脑浏览器用于日常开发，手机主要用于查看进度和审批。项目主文档、界面和提交信息使用英文。

当前是开发预览，尚未正式发布。已实现会话、流式显示、审批与提问、文件选区上下文、只读变更查看、断线恢复和操作回执。模拟器验收与真实 CLI 元数据检查分开进行；真实模型的隔离读写、历史与停止测试已通过；会实际弹出审批的权限策略、提问及实际部署仍需独立验收。

技术路线采用 `codex app-server` 的结构化协议。服务端持有 CLI 进程和任务状态，浏览器负责显示；关闭页面不会停止任务。服务重启会终止自己的 CLI 子进程，未确认结果的操作保留为 unknown，不会自动重发。

请先按英文 [README](../README.md) 安装 Node 24.x 和 Codex CLI 0.167.0，运行 `npm ci`、`npm run build`，再用 `CODES_PROJECT_ROOT=/绝对项目路径 npm start` 启动。默认地址是 `http://127.0.0.1:8790`，登录令牌保存在 `.local/access-token`。Codex 登录沿用服务端用户，不传给浏览器。

无需模型即可预览：`CODES_RUNTIME=mock CODES_DATA_DIR=.local/demo CODES_PROJECT_ROOT="$PWD" npm start`。界面会明确显示 Simulation；此模式不调用模型、不执行命令、不修改项目文件。

发生断连或回执不确定时，先使用 **Check result**，不要重复发送。未能从原生历史证明结束的操作会继续锁定。远程访问默认建议 SSH 隧道，手机使用需要配置私有 HTTPS 入口。

更多说明：[架构](architecture.md)、[验收标准](acceptance.md)、[开发里程碑](roadmap.md)、[运行与恢复](operations.md)。正式发版、发布标签和部署须由项目所有者另行确认。
