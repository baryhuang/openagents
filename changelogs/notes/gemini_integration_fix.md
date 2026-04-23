# Gemini CLI 集成与 Launcher 本地联调修复总结

**日期**: 2026-04-23
**涉及组件**: `agent-connector`, `launcher`

## 1. Gemini Adapter 核心解析修复 (`gemini.js`)
* **Bug 表现**: Gemini CLI 运行正常但在网页端 Workspace 中对话时，始终提示 `No response generated. Please try again.`
* **原因**: 在解析 `gemini -o stream-json` 的输出数据流时，错误地使用了转义字符串 `split('\\n')` 作为按行分割符，导致所有 JSON 输出黏连在一起引发解析异常，触发了底层的超时兜底逻辑。
* **修复**: 将按行读取缓冲区的分割符修正为原生的 `split('\n')`，使底层 JSON 事件能够被逐行且正确地解析，彻底解决了 Gemini 响应为空的问题。

## 2. Gemini 登录鉴权流改造 (`registry.json`)
* **改造前**: UI 强制要求用户输入 `GEMINI_API_KEY`，体验不佳。
* **改造后**: 移除了针对 Gemini 的 `env_config` 强制校验，新增了 `login_command: "gemini login"`。看齐 Claude 的交互流程，现在会引导用户直接调起终端，进行标准的 Google OAuth 网页授权。

## 3. Launcher 调试环境与性能优化 (`agent-manager.js` & `main.js`)
* **开发热更新修复**: 修改了 `AgentManager.loadCore()` 和守护进程执行路径逻辑。在开发环境下（`npm run start`）会优先判定并加载工程本地目录的 `agent-connector` 代码，而非默认调用全局安装的 `@openagents-org/agent-launcher`。解决了“无论怎么改本地代码，后台都不生效”的开发痛点。
* **界面卡顿优化**: 在 `package.json` 和 `main.js` 中新增了无头模式与 `--disable-gpu` (对应 `npm run dev:nogpu`) 启动选项，极大缓解了本地测试时 Launcher 图形界面极度卡顿、难以操作的问题。

## 4. 守护进程 (Daemon) 通信机制优化 (`base.js`)
* **响应速度大幅提升**: 重构了 `BaseAdapter._pollLoop()` 的长轮询策略（Adaptive Polling）。将空闲状态下，Daemon 询问远端 Workspace 消息的最大轮询等待时间**从 15 秒压缩至 3 秒**。大幅降低了消息延迟，使得人类与本地 Agent 的交互体感更加顺畅。
* **连接错误可观测性提升**: 为网络错误抛出处增加了详细的堆栈（`e.stack`）输出。在排查“假死”问题时，可直接在 `daemon.log` 中捕捉到 `ECONNREFUSED` 或 `Network not found` 的底层抛错。

## 📝 调试排坑记录 (Workspace 串台问题)
测试时曾遇到后端响应 `Network not found` 且拒绝连接：
* 原因是：**将本地后端的 Token 用在了线上生成环境中**。此前在本地运行 `http://localhost:8000` 后端时生成了一个名为 `Local Debug Workspace` 的配置文件，当拿着这个关联着本地接口的 Token 到线上（`workspace.openagents.org`）去连接时，跨服导致 404 拒绝。
* **经验教训**：线上版 Workspace 与本地私有化部署 Workspace 互不相通，测试时必须保证所获取 Token 的发放平台与当前 Launcher 运行指向的接口完全一致。
